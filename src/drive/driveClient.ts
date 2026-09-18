import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";

// Thin Google Drive wrapper scoped to appDataFolder (ADR-0002).
// Always uses Obsidian's requestUrl() — plain fetch() is blocked/CORS-limited
// inside plugins, especially on mobile.

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_CHANGES = "https://www.googleapis.com/drive/v3/changes";
const FILE_FIELDS = "id,name,headRevisionId,modifiedTime,trashed,size";

export interface DriveFile {
  id: string;
  name: string;
  headRevisionId?: string;
  modifiedTime?: string;
  trashed?: boolean;
  size?: string; // Drive returns size as a string
}

export interface ChangesPage {
  files: DriveFile[];
  /** Feed back into the next changes() call. */
  newStartPageToken?: string;
  nextPageToken?: string;
}

// Shapes of the Drive API responses we read (only the fields we request).
interface ErrorBody { error?: { message?: string } }
interface AboutBody { user?: { emailAddress?: string; displayName?: string } }
interface ListBody { files?: DriveFile[]; nextPageToken?: string }
interface StartTokenBody { startPageToken: string }
interface ChangesBody {
  changes?: { file?: DriveFile }[];
  newStartPageToken?: string;
  nextPageToken?: string;
}
interface IdBody { id: string }

/** requestUrl's .json getter throws on a non-JSON body; this returns undefined instead. */
function jsonOrUndefined(res: RequestUrlResponse): unknown {
  try {
    return res.json as unknown;
  } catch {
    return undefined;
  }
}

export class DriveClient {
  constructor(private getAccessToken: () => Promise<string>) {}

  private async authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getAccessToken()}`, ...extra };
  }

  /**
   * Wraps requestUrl to surface Google's JSON error message instead of a bare
   * status code, and to let callers handle non-2xx explicitly.
   */
  private async req(opts: RequestUrlParam): Promise<RequestUrlResponse> {
    const res = await requestUrl({ throw: false, ...opts });
    if (res.status < 200 || res.status >= 300) {
      const body = jsonOrUndefined(res) as ErrorBody | undefined;
      const msg = body?.error?.message ?? res.text ?? "unknown error";
      throw new Error(`Drive ${res.status}: ${msg}`);
    }
    return res;
  }

  /** A successful request's JSON body, typed as the fields we asked for. */
  private async json<T>(opts: RequestUrlParam): Promise<T> {
    return (await this.req(opts)).json as T;
  }

  // --- reads --------------------------------------------------------------

  /** The signed-in Google account (works with the drive.appdata scope). */
  async about(): Promise<{ email?: string; name?: string }> {
    const body = await this.json<AboutBody>({
      url: "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)",
      headers: await this.authHeaders(),
    });
    return { email: body.user?.emailAddress, name: body.user?.displayName };
  }

  /** List all non-trashed files in appDataFolder (paginated). */
  async list(): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const p = new URLSearchParams({
        spaces: "appDataFolder",
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: "1000",
        q: "trashed = false",
      });
      if (pageToken) p.set("pageToken", pageToken);
      const body = await this.json<ListBody>({ url: `${DRIVE_FILES}?${p.toString()}`, headers: await this.authHeaders() });
      files.push(...(body.files ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return files;
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    const res = await this.req({
      url: `${DRIVE_FILES}/${fileId}?alt=media`,
      headers: await this.authHeaders(),
    });
    return res.arrayBuffer;
  }

  /** Token to start watching changes from "now" (CONTEXT: 60s auto-sync). */
  async startPageToken(): Promise<string> {
    const body = await this.json<StartTokenBody>({
      url: `${DRIVE_CHANGES}/startPageToken?fields=startPageToken`,
      headers: await this.authHeaders(),
    });
    return body.startPageToken;
  }

  /** One page of changes since `pageToken` (call repeatedly until no nextPageToken). */
  async changes(pageToken: string): Promise<ChangesPage> {
    const p = new URLSearchParams({
      pageToken,
      spaces: "appDataFolder",
      fields: `newStartPageToken,nextPageToken,changes(file(${FILE_FIELDS}))`,
      pageSize: "1000",
      includeRemoved: "true",
    });
    const body = await this.json<ChangesBody>({ url: `${DRIVE_CHANGES}?${p.toString()}`, headers: await this.authHeaders() });
    const files = (body.changes ?? [])
      .map((c) => c.file)
      .filter((f): f is DriveFile => !!f);
    return {
      files,
      newStartPageToken: body.newStartPageToken,
      nextPageToken: body.nextPageToken,
    };
  }

  // --- writes -------------------------------------------------------------

  /**
   * Create a new file in appDataFolder. Two steps (metadata then media) to keep
   * the request bodies simple and avoid hand-assembling multipart/related.
   */
  async create(name: string, data: ArrayBuffer): Promise<DriveFile> {
    const meta = await this.json<IdBody>({
      url: `${DRIVE_FILES}?fields=id`,
      method: "POST",
      headers: await this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name, parents: ["appDataFolder"] }),
    });
    return this.update(meta.id, data);
  }

  /** Replace a file's content; returns the new headRevisionId. */
  async update(fileId: string, data: ArrayBuffer): Promise<DriveFile> {
    return this.json<DriveFile>({
      url: `${DRIVE_UPLOAD}/${fileId}?uploadType=media&fields=${FILE_FIELDS}`,
      method: "PATCH",
      headers: await this.authHeaders({ "Content-Type": "application/octet-stream" }),
      body: data,
    });
  }

  /** Rename a file in place (same id, content and revision are untouched). */
  async rename(fileId: string, name: string): Promise<void> {
    await this.req({
      url: `${DRIVE_FILES}/${fileId}?fields=id,name`,
      method: "PATCH",
      headers: await this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name }),
    });
  }

  /** Soft delete: move to Drive trash (recoverable, auto-purged by Google). */
  async trash(fileId: string): Promise<void> {
    await this.setTrashed(fileId, true);
  }

  /** Restore a soft-deleted file. */
  async untrash(fileId: string): Promise<void> {
    await this.setTrashed(fileId, false);
  }

  private async setTrashed(fileId: string, trashed: boolean): Promise<void> {
    await this.req({
      url: `${DRIVE_FILES}/${fileId}?fields=id,trashed`,
      method: "PATCH",
      headers: await this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ trashed }),
    });
  }

  /** Permanent delete — used by the retention purge only. */
  async deletePermanent(fileId: string): Promise<void> {
    await this.req({
      url: `${DRIVE_FILES}/${fileId}`,
      method: "DELETE",
      headers: await this.authHeaders(),
    });
  }
}

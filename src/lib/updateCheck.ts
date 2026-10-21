import Constants from 'expo-constants';
import * as Application from 'expo-application';

/**
 * Lightweight "is a newer APK available?" check for side-loaded builds.
 *
 * The app fetches a small JSON manifest you host (see `update-manifest.example.json`)
 * and compares its `versionCode` against the installed build's `versionCode`. This
 * covers the one thing OTA/EAS Update can't: shipping a brand-new native APK. It
 * is intentionally dependency-free — just a `fetch` + a numeric compare.
 *
 * Manifest shape:
 *   { "versionCode": 7, "versionName": "1.0.6", "apkUrl": "https://.../SeenIt-v7.apk" }
 */
export interface UpdateManifest {
  /** Android `versionCode` of the latest published APK (monotonic integer). */
  versionCode: number;
  /** Human-readable version name, e.g. "1.0.6". */
  versionName: string;
  /** Direct download URL of the latest APK (must be https). */
  apkUrl: string;
}

export type UpdateCheckResult =
  | { status: 'available'; versionName: string; apkUrl: string }
  | { status: 'latest' }
  | { status: 'not-configured' }
  | { status: 'error' };

/** Manifest URL: env override (for tests/CI) → app config → empty (unconfigured). */
function manifestUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_UPDATE_MANIFEST_URL;
  const fromConfig = (Constants.expoConfig?.extra as { updateManifestUrl?: string } | undefined)
    ?.updateManifestUrl;
  return (fromEnv || fromConfig || '').trim();
}

/**
 * The installed APK's Android `versionCode`, read from the native binary via
 * expo-application — NOT from `expoConfig`, because an OTA (EAS Update) can swap
 * in a published bundle's config and make `expoConfig.android.versionCode` reflect
 * the update rather than the installed APK. Returns null when it can't be read
 * (e.g. web), so the caller treats it as an error instead of guessing `0`.
 */
export function installedVersionCode(): number | null {
  const raw = Application.nativeBuildVersion; // Android: versionCode as a string
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** Fetch the manifest and compare it to the installed build. Never throws. */
export async function checkForUpdate(timeoutMs = 8000): Promise<UpdateCheckResult> {
  const url = manifestUrl();
  if (!url) return { status: 'not-configured' };

  const installed = installedVersionCode();
  if (installed == null) return { status: 'error' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return { status: 'error' };

    const data = (await res.json()) as Partial<UpdateManifest>;
    // The URL is opened as-is (Android hands it to the browser/downloader), so only
    // accept https — never another scheme or a plain-http download.
    if (
      typeof data?.versionCode !== 'number' ||
      typeof data?.apkUrl !== 'string' ||
      !/^https:\/\/\S+$/i.test(data.apkUrl)
    ) {
      return { status: 'error' };
    }

    if (data.versionCode > installed) {
      return {
        status: 'available',
        versionName:
          typeof data.versionName === 'string' && data.versionName
            ? data.versionName
            : String(data.versionCode),
        apkUrl: data.apkUrl,
      };
    }
    return { status: 'latest' };
  } catch {
    return { status: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

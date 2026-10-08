import { withBasePath } from "@/lib/base-path";

export function generateLink(path = "") {
  const baseUrl =
    import.meta.env.VITE_APP_URL ||
    `${window.location.protocol}//${window.location.host}`;

  return `${baseUrl}${withBasePath(path)}`;
}

import type { SourceLogoProps } from "@/components/import/source-logos/source-logo-size";
import { withBasePath } from "@/lib/base-path";
import { cn } from "@/lib/cn";

export function KaneoLogo({ size }: SourceLogoProps) {
  return (
    <img
      src={withBasePath("favicon.svg")}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn(
        "shrink-0",
        size === "sm" ? "size-[22px] rounded-[5px]" : "size-7 rounded-md",
      )}
    />
  );
}

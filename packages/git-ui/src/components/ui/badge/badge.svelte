<script lang="ts" module>
  import { type VariantProps, tv } from "tailwind-variants";

  export const badgeVariants = tv({
    base: "h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none",
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /*
       * Git-domain tones, added to the generated component (this is the one deliberate
       * edit to shadcn-svelte's file). A badge in a Git UI usually means something —
       * "this is HEAD", "this ref is a branch", "unmerged" — and the tone carries that
       * meaning so callers never pick colours by hand. `none` keeps the generated
       * variants in charge.
       */
      tone: {
        none: "",
        muted: "border-border bg-muted text-muted-foreground",
        branch: "border-lane-1/40 bg-lane-1/10 text-lane-1",
        head: "border-brand/40 bg-brand/15 text-brand",
        tag: "border-lane-3/40 bg-lane-3/10 text-lane-3",
        remote: "border-lane-6/40 bg-lane-6/10 text-lane-6",
        warn: "border-warn/40 bg-warn/10 text-warn",
        danger: "border-destructive/40 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
      tone: "none",
    },
  });

  export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
  export type BadgeTone = NonNullable<
    VariantProps<typeof badgeVariants>["tone"]
  >;
</script>

<script lang="ts">
  import { cn, type WithElementRef } from "../../../lib/utils.js";
  import type { HTMLAnchorAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    href,
    class: className,
    variant = "default",
    tone = "none",
    children,
    ...restProps
  }: WithElementRef<HTMLAnchorAttributes> & {
    variant?: BadgeVariant;
    tone?: BadgeTone;
  } = $props();
</script>

<svelte:element
  this={href ? "a" : "span"}
  bind:this={ref}
  data-slot="badge"
  {href}
  class={cn(badgeVariants({ variant, tone }), className)}
  {...restProps}
>
  {@render children?.()}
</svelte:element>

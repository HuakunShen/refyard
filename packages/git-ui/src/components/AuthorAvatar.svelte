<script lang="ts">
  /**
   * Round author avatar for history rows: the GitHub photo when the commit
   * email names a GitHub account, deterministic initials otherwise. The photo
   * load is lazy and falls back to initials on any failure (offline, deleted
   * account), so a row never renders a broken image.
   */
  import { authorAvatar, initialsAvatar } from "../lib/avatars.js";

  interface Props {
    email: string;
    name: string;
    size?: number;
  }

  let { email, name, size = 20 }: Props = $props();

  const avatar = $derived(authorAvatar(email, name));
  const fallback = $derived(initialsAvatar(email, name));
  let failed = $state(false);
  // A failed load belongs to one author: reset when the row recycles.
  $effect(() => {
    email;
    name;
    failed = false;
  });
</script>

{#if avatar.kind === "github" && !failed}
  <img
    src={avatar.url}
    alt=""
    width={size}
    height={size}
    loading="lazy"
    decoding="async"
    referrerpolicy="no-referrer"
    onerror={() => {
      failed = true;
    }}
    data-testid="author-avatar-img"
    class="shrink-0 rounded-full bg-muted object-cover"
    style="width: {size}px; height: {size}px"
  />
{:else}
  {@const shown = avatar.kind === "initials" ? avatar : fallback}
  <span
    aria-hidden="true"
    data-testid="author-avatar-initials"
    class="flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none"
    style="width: {size}px; height: {size}px; font-size: {Math.max(
      8,
      Math.round(size * 0.42),
    )}px; background: oklch(0.55 0.1 {shown.hue})"
  >
    {shown.initials}
  </span>
{/if}

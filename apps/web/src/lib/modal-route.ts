import { useRouter } from '@tanstack/react-router';

/**
 * Modal routes (Add expense, Settle, Edit) open on top of the page they belong to, so Back closes
 * them. Closing one with a fresh navigation would push a new entry, and Back would then reopen the
 * dialog. So a page that opens its own modal marks it here, and closing goes Back to that page.
 * A modal reached any other way (a link from elsewhere, a reload, the Home picker) closes by
 * replacing itself with its page instead.
 *
 * The mark is the opener's position in the history and the modal's path; Back is only used when
 * both still match.
 */
let mark: { index: number; path: string } | null = null;

/** In a page: returns a function to call as it opens its own modal at `path`. */
export function useMarkModalOpen() {
  const router = useRouter();
  return (path: string) => {
    mark = { index: router.state.location.state.__TSR_index, path };
  };
}

/** In a modal route: returns `close`, which goes Back to the opener, or else runs `fallback`. */
export function useCloseModal(fallback: () => void) {
  const router = useRouter();
  return () => {
    const { pathname, state } = router.state.location;
    const opened = mark;
    mark = null;
    if (opened && opened.path === pathname && opened.index + 1 === state.__TSR_index) {
      router.history.back();
    } else {
      fallback();
    }
  };
}

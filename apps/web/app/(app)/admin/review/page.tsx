// Staff-only screen (FR-B-3/FR-G-1 review queue). The role gate arrives with
// authentication in slice 4 — until then this route is unlinked: it does not
// appear as a chip, tab or link anywhere in the vendor navigation (see
// AppHeader.tsx), reachable only by typing the URL directly.
export { AdminReviewView as default } from "../../../../src/views/AdminReviewView";

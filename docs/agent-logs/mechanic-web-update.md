# Mechanic log — web update to new mockup

- [x] read the new mockup and compare against the existing views
  - [x] list what changed in Dashboard, Search, TOR Detail, Vendor Profile
    - Dashboard: agency sample numbers changed (new n/budget per agency); stat
      strip (TOR total/budget/agency count/anomaly count) now changes when an
      agency bar is filtered — current code always shows the same 4 fixed
      numbers; scatter plot now has 16 base points (was 14) + 2 flagged
      anomaly points (was 1), with new tip text/positions.
    - Search: unchanged — sidebar filters, result list, badges, star/bookmark
      all match the current SearchView already.
    - TOR Detail: unchanged — matches current TorDetailView already.
    - Vendor Profile: the "[ การแจ้งเตือน ]" card is fully redesigned — old
      ทันที/สรุปรายวัน toggle + bare minMatch slider replaced by 3 preset
      cards (all/balanced/few) + a collapsible "การตั้งค่าขั้นสูง" section
      (minMatch slider, lead-time button group 3/7/14 วัน, 2 toggle
      switches). Rest of the screen (head, skills, fact grid, starred/
      bookmarked cards, PDPA line) unchanged.
  - [x] header: bell + badge + dropdown are new; ADMIN/EMAIL demo chips and
        the login/logout + avatar-menu state are new in the mockup too, but
        out of scope per task instructions (bell only; app has no
        logged-out state).
- [x] header: notification bell, unread badge, dropdown panel
- [x] Notifications screen and its /notifications route
- [x] Admin Review Queue and its /admin/review route, unlinked from vendor navigation
- [x] update the four existing screens where they diverge
  - [x] Dashboard
  - [x] Vendor Profile
  - [x] Search (no changes needed)
  - [x] TOR Detail (no changes needed)
- [ ] gates
  - [x] npm run lint at the root — clean
  - [x] npm run build -w @tor-radar/web — compiled, all 8 routes generated
        (including new /admin/review and /notifications)
- [x] commit

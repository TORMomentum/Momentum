#!/usr/bin/env python3
"""
Collect real TOR (Terms of Reference) documents from BMA's official eGP BMA2 API.

Pipeline:
  1. GetProjectFromFilter (masterAnnounceTypeId = TOR type) -> list of projects that have a TOR announcement
  2. For each project, GetAnnouncementDetailInProject -> find the entry whose
     masterAnnounceTypeName == "ร่างขอบเขตของงาน (TOR)" and grab its (id, path)
  3. Download the real file from /api/file/<announcement id>/<path> (public, no auth needed)
  4. Write a metadata CSV (TOR-17 deliverable) alongside the downloaded files (TOR-16 deliverable)

Requires no authentication. --cookie / $BMA_EGP_COOKIE stay as an escape hatch only.
The file-download step itself needs no cookie.
"""
import argparse
import csv
import os
import re
import subprocess
import time
import urllib.parse
import json
import zlib

API_BASE = "https://egp2.bangkok.go.th/appapi/api"
FILE_BASE = "https://egp2.bangkok.go.th/api/file"
TOR_ANNOUNCE_TYPE_ID = "24995aa2-d875-4d3d-9dec-d5e22d222aa4"  # "ร่างขอบเขตของงาน (TOR)"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36")
CURL = "/usr/bin/curl"

FIELDNAMES = ["doc_id", "project_id", "project_number", "org_group", "org_department",
              "title", "announce_date", "format_type", "page_count", "embedded_fonts",
              "image_count", "file_size_bytes", "local_file", "source_url"]


def http_get(url, cookie=None, timeout=20):
    # Cloudflare blocks Python's urllib TLS fingerprint; shell out to curl instead.
    cmd = [CURL, "-s", "-L", url,
           "-H", "accept: application/json, text/plain, */*",
           "-H", f"user-agent: {UA}",
           "-H", "referer: https://egp2.bangkok.go.th/project-search",
           "--max-time", str(timeout)]
    if cookie:
        cmd += ["-b", cookie]
    result = subprocess.run(cmd, capture_output=True, timeout=timeout + 5)
    return result.stdout


def get_tor_projects(cookie, page_size=30, page_no=1, agency_id=""):
    q = {
        "externalUserId": "", "projectSearchText": "", "masterOrgGroupId": agency_id,
        "masterOrgDepartmentId": "", "masterAnnounceTypeId": TOR_ANNOUNCE_TYPE_ID,
        "masterMethodIdId": "", "masterTypeIdId": "", "masterGoodIdId": "",
        "masterBussinessTypeId": "", "masterProjectTypeId": "", "masterProjectCategoryId": "",
        "masterBudgetYearId": "", "startDate": "", "endDate": "",
        "pageNo": page_no, "pageSize": page_size, "sortBy": "publishDateDesc",
        "bidderName": "", "bidderTaxNumber": "",
    }
    url = f"{API_BASE}/Projects/GetProjectFromFilter?" + urllib.parse.urlencode(q)
    return json.loads(http_get(url, cookie))


def get_announcements(project_id, cookie):
    url = f"{API_BASE}/ProjectAnnouncements/GetAnnouncementDetailInProject?projectId={project_id}"
    return json.loads(http_get(url, cookie))


# A born-digital PDF draws glyphs with text operators; a scan is one image per page with none.
# Anything that fits neither pattern is left unlabelled rather than guessed at.
TEXT_OP_MIN = 200       # text-showing operators above this = a real text layer
SCAN_OP_MAX = 20        # ...and below this, with images present, = a scan


def classify_pdf(data):
    """Return (format_type, page_count, embedded_fonts, image_count).

    format_type is "text-pdf", "scanned-pdf", or "" when the file does not clearly fit
    either — an empty value is deliberate: better a blank cell than a wrong label.
    """
    if not data[:5].startswith(b"%PDF"):
        return "", 0, 0, 0
    fonts = len(re.findall(rb"/Type\s*/Font", data))
    images = len(re.findall(rb"/Subtype\s*/Image", data))
    pages = len(re.findall(rb"/Type\s*/Page[^s]", data))
    text_ops = 0
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", data, re.S):
        try:
            body = zlib.decompress(m.group(1))
        except Exception:
            continue  # not a Flate stream (e.g. a raw JPEG) — no text to find in it
        text_ops += len(re.findall(rb"\b(Tj|TJ)\b", body))
    if text_ops > TEXT_OP_MIN:
        return "text-pdf", pages, fonts, images
    if images and text_ops < SCAN_OP_MAX:
        return "scanned-pdf", pages, fonts, images
    return "", pages, fonts, images


def safe_filename(name, maxlen=80):
    """Sanitise and shorten, keeping the extension — truncating it away would leave a file
    nothing can tell the type of."""
    name = re.sub(r"[^\w\-.ก-๙]+", "_", name)
    if len(name) <= maxlen:
        return name
    stem, dot, ext = name.rpartition(".")
    if not dot or len(ext) > 8:
        return name[:maxlen]
    return stem[: maxlen - len(ext) - 1] + "." + ext


def recatalog(csv_path):
    """Re-classify an existing corpus in place: keeps every metadata column, replaces the
    format columns with values measured from the files on disk. No network access."""
    base = os.path.dirname(os.path.abspath(csv_path))
    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    tally = {}
    for r in rows:
        local = r.get("local_file", "")
        path = local if os.path.isabs(local) else os.path.join(base, local)
        if not os.path.exists(path):
            r["format_type"] = ""
            r["page_count"] = r["embedded_fonts"] = r["image_count"] = ""
            print(f"  ? missing on disk, format left blank: {local}")
            tally["missing"] = tally.get("missing", 0) + 1
            continue
        with open(path, "rb") as fh:
            data = fh.read()
        fmt, pages, fonts, images = classify_pdf(data)
        r["format_type"] = fmt
        r["page_count"] = pages
        r["embedded_fonts"] = fonts
        r["image_count"] = images
        r["file_size_bytes"] = len(data)
        label = fmt or "unidentified"
        tally[label] = tally.get(label, 0) + 1
        print(f"  {label:14} {pages:>3}p  fonts {fonts:>3}  images {images:>3}  {os.path.basename(local)[:46]}")

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    print(f"\n{len(rows)} rows re-catalogued -> {csv_path}")
    for k in sorted(tally):
        print(f"  {tally[k]:3d}  {k}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recatalog", metavar="CSV",
                    help="re-classify an existing metadata CSV from the files on disk, no downloads")
    ap.add_argument("--cookie", default=os.environ.get("BMA_EGP_COOKIE"),
                    help="Optional cookie header string; the API needs no auth, so this is only "
                         "an escape hatch if access rules change (see docs/DATA-SOURCES.md)")
    ap.add_argument("--limit", type=int, default=20, help="How many TOR documents to download")
    ap.add_argument("--out", default="files", help="Output folder for downloaded files")
    ap.add_argument("--want", choices=["text-pdf", "scanned-pdf"],
                    help="keep only documents of this format; others are classified and discarded")
    ap.add_argument("--agency-id", help="restrict to one BMA agency (a MasterOrgGroups id — "
                                        "see apps/api/src/data/bma-agencies.json)")
    ap.add_argument("--append", action="store_true",
                    help="add to an existing corpus and CSV instead of replacing it")
    ap.add_argument("--max-pages", type=int, default=10, help="how many result pages to walk")
    args = ap.parse_args()

    if args.recatalog:
        recatalog(args.recatalog)
        return

    os.makedirs(args.out, exist_ok=True)
    csv_path = os.path.join(os.path.dirname(args.out) or ".", "tor17_metadata.csv")
    rows = []
    if args.append and os.path.exists(csv_path):
        with open(csv_path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        print(f"appending to {len(rows)} existing rows in {csv_path}")
    already = {r["doc_id"] for r in rows}
    downloaded = 0
    page_no = 1

    while downloaded < args.limit and page_no <= args.max_pages:
        result = get_tor_projects(args.cookie, page_size=20, page_no=page_no,
                                  agency_id=args.agency_id or "")
        projects = result.get("data", [])
        if not projects:
            break
        print(f"[page {page_no}] {len(projects)} projects, totalCount={result.get('totalCount')}")

        for p in projects:
            if downloaded >= args.limit:
                break
            pid = p["projectId"]
            try:
                ann = get_announcements(pid, args.cookie)
            except Exception as e:
                print(f"  ! announcement fetch failed for {pid}: {e}")
                continue

            tor_entries = [a for a in ann.get("data", [])
                            if a.get("masterAnnounceTypeName") == "ร่างขอบเขตของงาน (TOR)"
                            and a.get("projectAnnouncementPath")]
            for a in tor_entries:
                aid = a["id"]
                if aid in already:
                    continue
                path = a["projectAnnouncementPath"]
                file_url = f"{FILE_BASE}/{aid}/{urllib.parse.quote(path)}"
                local_name = safe_filename(f"{p['projectNumber']}_{path}")
                local_path = os.path.join(args.out, local_name)
                csv_dir = os.path.dirname(os.path.abspath(csv_path))
                rel_path = os.path.relpath(os.path.abspath(local_path), csv_dir)
                try:
                    data = http_get(file_url)  # no cookie needed
                    with open(local_path, "wb") as f:
                        f.write(data)
                    fmt, pages, fonts, images = classify_pdf(data)
                    if args.want and fmt != args.want:
                        os.remove(local_path)
                        print(f"  - skipped ({fmt or 'unidentified'}): {local_name[:48]}")
                        time.sleep(0.3)
                        continue
                    rows.append({
                        "doc_id": aid,
                        "project_id": pid,
                        "project_number": p["projectNumber"],
                        "org_group": p.get("masterOrgGroupName", ""),
                        "org_department": p.get("masterOrgDepartmentName", ""),
                        "title": p["projectName"],
                        "announce_date": a.get("projectAnnouncementPublishDate", ""),
                        "format_type": fmt,
                        "page_count": pages,
                        "embedded_fonts": fonts,
                        "image_count": images,
                        "file_size_bytes": len(data),
                        "local_file": rel_path,
                        "source_url": file_url,
                    })
                    downloaded += 1
                    print(f"  + [{downloaded}/{args.limit}] {local_name} ({len(data)} bytes)")
                except Exception as e:
                    print(f"  ! download failed for {file_url}: {e}")
                time.sleep(0.3)  # be polite
            if downloaded >= args.limit:
                break
        page_no += 1

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        fieldnames = FIELDNAMES
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)

    print(f"\nDone. Downloaded {downloaded} real TOR files -> {args.out}/")
    print(f"Metadata CSV -> {csv_path}")


if __name__ == "__main__":
    main()

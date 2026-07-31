#!/usr/bin/env python3
"""Fetch every package listed in the pi.dev package catalog.

The catalog is server-rendered and paginated. This script follows all catalog pages,
extracts the package-card metadata, and writes reproducible JSON plus an optional
human-readable Markdown index. It intentionally does not execute package code.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

BASE_URL = "https://pi.dev"
CATALOG_URL = f"{BASE_URL}/packages"
USER_AGENT = "pi-workbench-package-index/1.0 (+https://pi.dev/packages)"


class CatalogParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.packages: list[dict[str, Any]] = []
        self.current: dict[str, Any] | None = None
        self.depth = 0
        self.capture: str | None = None
        self.capture_depth = 0
        self.text: list[str] = []
        self.meta_values: list[str] = []
        self.meta_depth: int | None = None
        self.links: list[tuple[str, str]] = []

    @staticmethod
    def _classes(attrs: dict[str, str | None]) -> set[str]:
        return set((attrs.get("class") or "").split())

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = dict(attrs_list)
        if tag == "article" and attrs.get("data-package-card") == "true":
            self.current = {
                "name": attrs.get("data-package-name", ""),
                "types": (attrs.get("data-package-types") or "").split(),
                "monthly_downloads": int(attrs.get("data-package-downloads") or 0),
                "published_at": datetime.fromtimestamp(
                    int(attrs.get("data-package-date") or 0) / 1000, timezone.utc
                ).isoformat(),
                "search_text": attrs.get("data-package-search", ""),
            }
            self.depth = 1
            self.meta_values = []
            self.meta_depth = None
            self.links = []
            return

        if self.current is None:
            return
        self.depth += 1
        classes = self._classes(attrs)
        if tag == "p" and "packages-desc" in classes:
            self._begin_capture("description")
        elif tag == "div" and "packages-meta" in classes:
            self.meta_depth = self.depth
        elif tag == "span" and self.meta_depth is not None:
            self._begin_capture("meta-token")
        elif tag == "code" and "packages-install" not in classes:
            self._begin_capture("install")
        elif tag == "a" and attrs.get("href"):
            self.links.append((attrs["href"] or "", ""))
            self._begin_capture(f"link:{len(self.links) - 1}")

    def _begin_capture(self, kind: str) -> None:
        if self.capture is None:
            self.capture = kind
            self.capture_depth = self.depth
            self.text = []

    def handle_data(self, data: str) -> None:
        if self.capture is not None:
            self.text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self.current is None:
            return
        if self.capture is not None and self.depth == self.capture_depth:
            value = " ".join("".join(self.text).split())
            if self.capture == "description":
                self.current["description"] = value
            elif self.capture == "meta-token":
                self.meta_values.append(value)
            elif self.capture == "install":
                self.current["install"] = value.removeprefix("$ ")
            elif self.capture.startswith("link:"):
                index = int(self.capture.split(":", 1)[1])
                href, _ = self.links[index]
                self.links[index] = (href, value)
            self.capture = None
            self.text = []

        if self.meta_depth == self.depth:
            self.meta_depth = None
        self.depth -= 1
        if self.depth == 0:
            self._finish_package()

    def _finish_package(self) -> None:
        assert self.current is not None
        package = self.current
        package["description"] = package.get("description", "")
        package["catalog_url"] = f"{BASE_URL}/packages/{urllib.parse.quote(package['name'], safe='@/') }"

        for href, label in self.links:
            absolute = urllib.parse.urljoin(BASE_URL, href)
            if label == "npm":
                package["npm_url"] = absolute
            elif label == "repo":
                package["repository_url"] = absolute
            elif href.startswith("/packages/"):
                package["catalog_url"] = urllib.parse.urljoin(BASE_URL, href.split("?", 1)[0])
            elif "package-report" in href:
                query = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
                version = query.get("package-version", [None])[0]
                if version:
                    package["version"] = version

        if self.meta_values:
            package["author"] = self.meta_values[0]

        package.setdefault("author", "")
        package.setdefault("version", "")
        package.setdefault("npm_url", "")
        package.setdefault("repository_url", "")
        package.setdefault("install", f"pi install npm:{package['name']}")
        self.packages.append(package)
        self.current = None


def fetch(url: str, retries: int = 3) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8")
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt + 1 == retries:
                raise RuntimeError(f"failed to fetch {url}: {error}") from error
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def page_count(document: str) -> int:
    pages = [int(value) for value in re.findall(r'href="/packages\?page=(\d+)"', document)]
    return max(pages, default=1)


def parse_page(document: str) -> list[dict[str, Any]]:
    parser = CatalogParser()
    parser.feed(document)
    return parser.packages


def markdown_index(catalog: dict[str, Any]) -> str:
    lines = [
        "# pi.dev package catalog index",
        "",
        f"Generated from [{catalog['source']}]({catalog['source']}) at "
        f"`{catalog['fetched_at']}` by `scripts/fetch-pi-packages.py`.",
        "",
        f"Packages: **{catalog['package_count']:,}**. Monthly download counts and package "
        "metadata are mutable catalog observations, not quality or security endorsements.",
        "",
        "| Package | Types | Downloads/mo | Version | Author | Description |",
        "| --- | --- | ---: | --- | --- | --- |",
    ]
    for package in catalog["packages"]:
        description = package["description"].replace("|", "\\|").replace("\n", " ")
        types = ", ".join(package["types"]) or "unclassified"
        lines.append(
            f"| [{package['name']}]({package['catalog_url']}) | {types} | "
            f"{package['monthly_downloads']:,} | {package['version'] or '—'} | "
            f"{package['author'] or '—'} | {description} |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("docs/ledgers/pi-packages-index.json"))
    parser.add_argument("--markdown", type=Path, default=Path("docs/ledgers/pi-packages-index.md"))
    parser.add_argument("--delay", type=float, default=0.05, help="delay between catalog requests")
    args = parser.parse_args()

    first_document = fetch(CATALOG_URL)
    pages = page_count(first_document)
    packages = parse_page(first_document)
    print(f"fetched page 1/{pages}: {len(packages)} packages", file=sys.stderr)

    for page in range(2, pages + 1):
        time.sleep(args.delay)
        document = fetch(f"{CATALOG_URL}?page={page}")
        page_packages = parse_page(document)
        if not page_packages:
            raise RuntimeError(f"page {page} contained no package cards")
        packages.extend(page_packages)
        print(f"fetched page {page}/{pages}: {len(page_packages)} packages", file=sys.stderr)

    unique = {package["name"]: package for package in packages}
    if len(unique) != len(packages):
        raise RuntimeError(f"catalog contained {len(packages) - len(unique)} duplicate package names")

    catalog = {
        "schema_version": 1,
        "source": CATALOG_URL,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "page_count": pages,
        "package_count": len(packages),
        "packages": packages,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")
    if args.markdown:
        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text(markdown_index(catalog))
    print(f"wrote {len(packages)} packages to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

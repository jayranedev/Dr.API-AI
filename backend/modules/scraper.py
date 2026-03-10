import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

def is_api_doc_link(url):
    """Only follow links that look like API documentation."""
    path = urlparse(url).path.lower()

    skip_keywords = ["blog", "pricing", "careers", "login", "signup",
                     "changelog", "status", "support", "community",
                     "twitter", "github", "forum"]
    
    if any(skip in path for skip in skip_keywords):
        return False
    
    return True

def scrape_documentation(url, max_pages=20):
    """
    Crawls API documentation and extracts clean text.
    Returns structured result with text and metadata.
    """
    visited = set()
    all_text = []
    to_visit = [url]
    base_domain = urlparse(url).netloc

    while to_visit and len(visited) < max_pages:
        current_url = to_visit.pop(0)

        if current_url in visited:
            continue
        visited.add(current_url)

        try:
            response = requests.get(current_url, timeout=10, headers={
                "User-Agent": "Mozilla/5.0 (compatible; DrAPI/1.0)"
            })
            if response.status_code != 200:
                continue
        except Exception:
            continue

        soup = BeautifulSoup(response.text, "html.parser")

        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        
        text = soup.get_text(separator="\n", strip=True)

        if text:
            all_text.append(f"\n--- Page: {current_url} ---\n{text}")

        for link in soup.find_all("a", href=True):
            full_url = urljoin(current_url, link["href"])

            if urlparse(full_url).netloc == base_domain:
                clean_url = full_url.split("#")[0]
                if clean_url not in visited and is_api_doc_link(clean_url):
                    to_visit.append(clean_url)

    combined_text = "\n".join(all_text)

    if len(combined_text) > 50000:
        combined_text = combined_text[:50000]

    return {
        "text": combined_text,
        "pages_scraped": len(visited),
        "urls": list(visited)
    }
    

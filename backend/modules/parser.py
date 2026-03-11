import os 
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

_client = None

def get_client():
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _client

def chunk_text(text, chunk_size=12000):
    """
    Splits large text into chunks so we can send each to OpenAI separately.
    This catches endpoints that get cut off when text is too long.
    """
    chunks = []
    words = text.split()
    current_chunk = []
    current_size = 0

    for word in words:
        current_size += len(word) + 1
        current_chunk.append(word)

        if current_size >= chunk_size:
            chunks.append(" ".join(current_chunk))
            current_chunk = []
            current_size = 0

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks

def parse_documentation(doc_text):
    """
    Sends scraped documentation text to OpenAI.
    Processes in chunks to catch all endpoints.
    """

    prompt = """You are an expert API documentation analyzer.

Analyze the following API documentation and extract ALL information into this exact JSON structure:

{
    "api_name": "Name of the API",
    "base_url": "The base URL for API requests",
    "auth_type": "Bearer Token / API Key / Basic Auth / OAuth2 / None",
    "auth_details": "How to authenticate",
    "endpoints": [
        {
            "method": "GET/POST/PUT/DELETE/PATCH",
            "path": "/v1/example",
            "description": "What this endpoint does",
            "parameters": [
                {
                    "name": "param_name",
                    "type": "string/integer/boolean/object",
                    "required": true,
                    "description": "What this parameter does"
                }
            ],
            "request_body": "Example request body if applicable (as JSON string)",
            "response_example": "Example response if found (as JSON string)"
        }
    ]
}

RULES:
- Extract EVERY endpoint you can find
- If information is missing, use "unknown"
- Always return valid JSON, nothing else
- No markdown, no explanation, ONLY the JSON object

Documentation text:
"""

    chunks = chunk_text(doc_text)
    all_endpoints = []
    api_info = {}
    last_error = None

    for chunk in chunks:
        try:
            response = get_client().chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an API documentation parser. Return ONLY valid JSON. No markdown, no backticks, no explanation."
                    },
                    {
                        "role": "user",
                        "content": prompt + chunk
                    }
                ],
                temperature=0.1,
                max_tokens=4096
            )

            result_text = response.choices[0].message.content.strip()

            if result_text.startswith("```"):
                result_text = result_text.split("```")[1]
                if result_text.startswith("json"):
                    result_text = result_text[4:]
                result_text = result_text.strip()

            parsed = json.loads(result_text)

            if not api_info:
                api_info = {
                    "api_name": parsed.get("api_name", "Unknown API"),
                    "base_url": parsed.get("base_url", "unknown"),
                    "auth_type": parsed.get("auth_type", "unknown"),
                    "auth_details": parsed.get("auth_details", "")
                }

            all_endpoints.extend(parsed.get("endpoints", []))

        except json.JSONDecodeError as e:
            last_error = f"JSON parse error: {e}"
            continue
        except Exception as e:
            last_error = str(e)
            continue

    seen = set()
    unique_endpoints = []
    for ep in all_endpoints:
        key = f"{ep.get('method', '')} {ep.get('path', '')}"
        if key not in seen:
            seen.add(key)
            unique_endpoints.append(ep)

    api_info["endpoints"] = unique_endpoints

    if not unique_endpoints:
        detail = f"No endpoints found. Last error: {last_error}" if last_error else "No endpoints found — the page may require JavaScript or have no API documentation."
        return {"error": detail}

    return api_info
    
def ask_about_api(doc_text, api_schema, question):
    context = f"""You are a helpful API assistant. You have access to this API documentation:
    {doc_text[:10000]}

    And this extracted API schema:
    {json.dumps(api_schema, indent=2)[:5000]}

    Answer the user's question about this API. Be concise and practical.
    Give code examples when relevant.
    """

    try:
        response = get_client().chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content":context},
                {"role":"user", "content":question}
            ],
            temperature=0.3,
            max_tokens=1000
        )
        return{"answer": response.choices[0].message.content.strip()}
    except Exception as e:
        return {"error": str(e)}
    


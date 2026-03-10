import os
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def generate_sdk(api_schema, language="python", selected_endpoints=None):

    # Filter to only selected endpoints
    endpoints = api_schema.get("endpoints", [])
    if selected_endpoints:
        endpoints = [
            ep for ep in endpoints
            if f"{ep['method']} {ep['path']}" in selected_endpoints
        ]

    schema_text = json.dumps({
        "api_name": api_schema.get("api_name", "Unknown API"),
        "base_url": api_schema.get("base_url", "https://api.example.com"),
        "auth_type": api_schema.get("auth_type", "unknown"),
        "auth_details": api_schema.get("auth_details", ""),
        "endpoints": endpoints
    }, indent=2)

    language_instructions = {
        "python": """Generate a Python SDK class using the 'requests' library.
- Class name should be based on the API name (e.g., StripeClient)
- __init__ should accept api_key parameter
- Each endpoint becomes a method with proper parameters
- Include type hints
- Include docstrings for each method
- Handle authentication in headers
- Return response.json()""",

        "nodejs": """Generate a Node.js SDK class using 'axios'.
- Use ES6 class syntax
- Constructor should accept apiKey parameter
- Each endpoint becomes an async method
- Include JSDoc comments
- Handle authentication in headers
- Return response data""",

        "curl": """Generate cURL commands for each endpoint.
- Include authentication headers
- Include example request bodies where needed
- Add comments explaining each command
- Make them copy-paste ready"""
    }

    prompt = f"""You are an expert SDK developer.

Generate a complete, production-ready {language} SDK based on this API schema:

{schema_text}

{language_instructions.get(language, language_instructions["python"])}

RULES:
- Generate ONLY code, no explanations before or after
- The code should be complete and runnable
- Include a usage example at the bottom as comments
- Handle errors gracefully
- No markdown backticks, just raw code
"""
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert SDK developer. Generate clean, production-ready code. Return ONLY code with no markdown formatting."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.2,
            max_tokens=4096
        )

        code = response.choices[0].message.content.strip()

        if code.startswith("```"):
            lines = code.split("\n")
            lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            code = "\n".join(lines)

        return {
            "language": language,
            "code": code,
            "endpoints_count": len(endpoints)
        }

    except Exception as e:
        return {"error": str(e)}

def generate_postman_collection(api_schema, selected_endpoints=None):

    endpoints = api_schema.get("endpoints", [])

    if selected_endpoints:
        endpoints = [
            ep for ep in endpoints
            if f"{ep['method']} {ep['path']}" in selected_endpoints
        ]

    base_url = api_schema.get("base_url", "https://api.example.com")
    api_name = api_schema.get("api_name", "API")
    auth_type = api_schema.get("auth_type", "Bearer Token")

    items = []
    for ep in endpoints:
        body = None
        if ep["method"] in ["POST", "PUT", "PATCH"] and ep.get("parameters"):
            body_data = {}
            for param in ep["parameters"]:
                body_data[param["name"]] = f"<{param.get('type', 'string')}>"
            body = {
                "mode": "raw",
                "raw": json.dumps(body_data, indent=2),
                "options": {"raw": {"language": "json"}}
            }

        query_params = []
        if ep["method"] == "GET" and ep.get("parameters"):
            for param in ep["parameters"]:
                query_params.append({
                    "key": param["name"],
                    "value": "",
                    "description": param.get("description", "")
                })

        item = {
            "name": ep.get("description", ep["path"]),
            "request": {
                "method": ep["method"],
                "header": [
                    {"key": "Content-Type", "value": "application/json"},
                    {"key": "Authorization", "value": f"Bearer {{{{api_key}}}}"}
                ],
                "url": {
                    "raw": base_url + ep["path"],
                    "host": [base_url.replace("https://", "").replace("http://", "")],
                    "path": ep["path"].strip("/").split("/"),
                    "query": query_params
                }
            }
        }

        if body:
            item["request"]["body"] = body

        items.append(item)

    collection = {
        "info": {
            "name": f"{api_name} - Generated by DrAPI",
            "description": f"Auto-generated Postman collection for {api_name}",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
        },
        "item": items,
        "auth": {
            "type": "bearer",
            "bearer": [{"key": "token", "value": "{{api_key}}"}]
        }
    }

    return collection
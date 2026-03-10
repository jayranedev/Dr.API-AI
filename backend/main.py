from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import json

from modules.scraper import scrape_documentation
from modules.parser import parse_documentation, ask_about_api
from modules.generator import generate_sdk, generate_postman_collection

app = FastAPI(
    title="Dr.API AI",
    description="Transform API documentation into production-ready SDKs",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalyzeRequest(BaseModel):
    url: str

class GenerateRequest(BaseModel):
    api_schema: dict
    language: str = "python"
    selected_endpoints: Optional[List[str]] = None

class ChatRequest(BaseModel):
    doc_text: str
    api_schema: dict
    question: str

class PostmanRequest(BaseModel):
    api_schema: dict
    selected_endpoints: Optional[List[str]] = None

session_data = {}

@app.post("/analyze")
async def analyze_docs(request: AnalyzeRequest):

    scrape_result = scrape_documentation(request.url)

    if not scrape_result["text"]:
        raise HTTPException(status_code=400, detail="Could not extract text from URL")

    api_schema = parse_documentation(scrape_result["text"])

    if "error" in api_schema:
        raise HTTPException(status_code=500, detail=api_schema["error"])

    session_data["doc_text"] = scrape_result["text"]
    session_data["api_schema"] = api_schema
    session_data["scrape_info"] = {
        "pages_scraped": scrape_result["pages_scraped"],
        "urls": scrape_result["urls"]
    }

    return {
        "api_schema": api_schema,
        "scrape_info": session_data["scrape_info"]
    }

@app.post("/generate")
async def generate_code(request: GenerateRequest):

    result = generate_sdk(
        api_schema=request.api_schema,
        language=request.language,
        selected_endpoints=request.selected_endpoints
    )

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return result

@app.post("/chat")
async def chat_about_api(request: ChatRequest):
 
    result = ask_about_api(
        doc_text=request.doc_text,
        api_schema=request.api_schema,
        question=request.question
    )

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return result

@app.post("/postman")
async def export_postman(request: PostmanRequest):

    collection = generate_postman_collection(
        api_schema=request.api_schema,
        selected_endpoints=request.selected_endpoints
    )

    return collection

@app.get("/")
async def root():
    """Health check — verify server is running."""
    return {"status": "running", "app": "Dr.API AI"}

@app.get("/session")
async def get_session():
    """Returns stored session data (for page refresh recovery)."""
    if not session_data:
        raise HTTPException(status_code=404, detail="No session data")
    return session_data
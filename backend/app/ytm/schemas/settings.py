"""Settings/API key schemas."""

from pydantic import BaseModel


class ApiKeyRequest(BaseModel):
    api_keys: str


class ApiKeyResponse(BaseModel):
    api_keys: str


class ApiKeyCheckResult(BaseModel):
    key_preview: str
    ok: bool
    error: str | None = None


class ApiKeyCheckResponse(BaseModel):
    results: list[ApiKeyCheckResult]

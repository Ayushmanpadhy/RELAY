from typing import Any, Literal

from pydantic import BaseModel, Field


class FileManifest(BaseModel):
    name: str
    type: str
    bytes: int
    units: int
    unitKind: Literal["numbers", "rows", "lines", "tokens", "pages", "images", "unknown"]
    preview: str


class Manifest(BaseModel):
    files: list[FileManifest] = Field(default_factory=list)
    totalUnits: int = 0
    unitKind: Literal["numbers", "rows", "lines", "tokens", "pages", "images", "unknown"] = "lines"
    summary: str = ""


class Plan(BaseModel):
    intent: str
    mode: Literal["exact", "ai"]
    tool: str | None = None
    toolArgs: dict[str, Any] = Field(default_factory=dict)
    instruction: str | None = None
    outputSchema: dict[str, Any] | None = None
    splitStrategy: Literal["items", "lines", "rows", "pages", "files", "tokens"] = "lines"
    partCountHint: int = 10
    partCount: int = 10
    partCountReason: str = ""
    reduce: Literal["sum", "merge_counts", "concat", "table_union", "llm_synthesis"] = "concat"
    resultStyle: str = "concise and clear"
    clarifyingQuestions: list[str] = Field(default_factory=list)


class PartAttempt(BaseModel):
    nodeId: str
    provider: str
    model: str
    durationMs: int
    error: str | None = None
    timestamp: float


class Part(BaseModel):
    partId: str
    idx: int
    size: int
    execution: Literal["tool", "ai"]
    tool: str | None = None
    toolArgs: dict[str, Any] = Field(default_factory=dict)
    instruction: str | None = None
    inputRef: dict[str, Any] = Field(default_factory=dict)
    nodeId: str | None = None
    provider: str | None = None
    model: str | None = None
    attempts: list[PartAttempt] = Field(default_factory=list)
    status: Literal["queued", "running", "done", "failed", "dead"] = "queued"
    output: Any | None = None
    error: str | None = None
    crossCheckMatch: bool | None = None


class ResultFile(BaseModel):
    name: str
    size: int
    downloadUrl: str


class JobResult(BaseModel):
    headline: str
    explanation: str
    files: list[ResultFile] = Field(default_factory=list)


class JobPublic(BaseModel):
    id: str
    userId: str
    promptPreview: str
    status: Literal["queued", "analyzing", "working", "assembling", "done", "failed"] = "queued"
    progress: int = 0
    stepLabel: str = "Queued"
    createdAt: str
    finishedAt: str | None = None
    result: JobResult | None = None
    clarifyingQuestions: list[str] = Field(default_factory=list)
    fileCount: int = 0


class JobInternal(BaseModel):
    id: str
    userId: str
    fullPrompt: str
    files: list[str] = Field(default_factory=list)
    manifest: Manifest | None = None
    plan: Plan | None = None
    partCount: int = 0
    mode: Literal["exact", "ai"] = "ai"
    callMode: Literal["batched", "individual"] = "batched"
    status: Literal["queued", "analyzing", "working", "assembling", "done", "failed"] = "queued"
    progress: int = 0
    stepLabel: str = "Queued"
    stats: dict[str, Any] = Field(default_factory=dict)
    reassignments: int = 0
    crashedAttempts: int = 0
    providersUsed: list[str] = Field(default_factory=list)
    createdAt: str
    finishedAt: str | None = None
    result: JobResult | None = None
    error: str | None = None

import os
from pathlib import Path

class CodexUnavailable(RuntimeError):
    pass

def run_codex(prompt: str, workspace: str) -> str:
    """
    Optional single-user adapter. Never expose a server-wide Codex login to a
    multi-user public app. For production, route each user's approved job to
    a dedicated isolated worker with its own supported auth flow.
    """
    if os.getenv("CODEX_SINGLE_USER_MODE", "false").lower() != "true":
        raise CodexUnavailable(
            "Codex worker chưa được bật. Website nhiều người dùng không được "
            "dùng chung một phiên đăng nhập Codex. Hãy tích hợp SIWC/worker riêng "
            "cho từng người theo tài liệu OpenAI."
        )
    try:
        from openai_codex import Codex, Sandbox
    except ImportError as exc:
        raise CodexUnavailable("Chưa cài openai-codex trong môi trường worker.") from exc

    # Explicitly workspace-write sandbox. This mode is for a dedicated single-user
    # worker only; it is not a security boundary for arbitrary public uploads.
    # The SDK follows the process working directory. This is only permitted in
    # single-user mode, so changing cwd cannot cross another user workspace.
    previous = os.getcwd()
    os.chdir(str(Path(workspace).resolve()))
    try:
        with Codex() as codex:
            thread = codex.thread_start(sandbox=Sandbox.workspace_write)
            result = thread.run(prompt)
            return result.final_response
    finally:
        os.chdir(previous)

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[".env", ".env.local", "../../.env.local"],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    anthropic_api_key: str = ""
    minimax_api_key: str = ""
    minimax_base_url: str = "https://api.minimax.io"
    atelier_db_url: str = "sqlite+aiosqlite:///./atelier.db"
    atelier_assets_dir: str = "../../assets"
    atelier_sandbox_port: int = 4100
    atelier_api_port: int = 8000
    atelier_web_port: int = 3000

    # Storage selection. "local" = sandbox-server reads from disk (dev).
    # "supabase" = uploads variants to Supabase Storage public bucket (hosted);
    # iframes still go through the sandbox-server proxy because Supabase forces
    # text/plain on HTML objects, which would break rendering otherwise.
    atelier_storage_mode: str = "local"
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_bucket: str = "variants"
    # Public base URL of the sandbox proxy used to serve variant iframes in
    # hosted mode. Example: https://atelier-sandbox.onrender.com
    atelier_sandbox_public_url: str = ""

    # Hosted CORS — comma-separated origins to allow alongside localhost.
    # In Render, set ATELIER_ALLOWED_ORIGINS=https://atelier.onrender.com (or your custom domain).
    atelier_allowed_origins: str = ""

    @property
    def assets_path(self) -> Path:
        p = Path(self.atelier_assets_dir).resolve()
        p.mkdir(parents=True, exist_ok=True)
        (p / "variants").mkdir(exist_ok=True)
        (p / "seeds").mkdir(exist_ok=True)
        (p / "thumbnails").mkdir(exist_ok=True)
        return p

    @property
    def sandbox_base_url(self) -> str:
        return f"http://localhost:{self.atelier_sandbox_port}"


settings = Settings()

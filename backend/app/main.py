import json
import logging
import logging.config
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.api.analytics import router as analytics_router
from app.api.builder import router as builder_router
from app.api.export import router as export_router
from app.api.health import router as health_router
from app.api.portfolios import router as portfolios_router
from app.api.profile import router as profile_router
from app.api.universe import router as universe_router
from app.api.watchlist import router as watchlist_router


class _JsonFormatter(logging.Formatter):
    """Minimal JSON log formatter — no external dependencies."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def _configure_logging(log_level: str) -> None:
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "json": {"()": _JsonFormatter},
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "json",
                },
            },
            "root": {"level": log_level, "handlers": ["console"]},
            "loggers": {
                "uvicorn": {"propagate": True},
                "uvicorn.access": {"propagate": True},
                "uvicorn.error": {"propagate": True},
            },
        }
    )


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    logger = logging.getLogger("buildtech")
    logger.info("BuildTech API starting")
    yield
    logger.info("BuildTech API shutting down")


def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        settings = get_settings()

    _configure_logging(settings.log_level)

    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=_lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(health_router, prefix=settings.api_v1_prefix)
    application.include_router(profile_router, prefix=settings.api_v1_prefix)
    application.include_router(universe_router, prefix=settings.api_v1_prefix)
    application.include_router(watchlist_router, prefix=settings.api_v1_prefix)
    application.include_router(builder_router, prefix=settings.api_v1_prefix)
    application.include_router(portfolios_router, prefix=settings.api_v1_prefix)
    application.include_router(export_router, prefix=settings.api_v1_prefix)
    application.include_router(analytics_router, prefix=settings.api_v1_prefix)

    return application


app = create_app()


if __name__ == "__main__":
    import uvicorn

    _settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=_settings.debug,
        log_config=None,  # logging managed by _configure_logging()
    )

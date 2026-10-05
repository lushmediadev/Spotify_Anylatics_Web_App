from app.config import settings as shared_settings


class SharedSettings:
    YOUTUBE_HTTP_TIMEOUT_SECONDS = 20

    def __getattr__(self, key):
        return getattr(shared_settings, key)


settings = SharedSettings()

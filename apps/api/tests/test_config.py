import pytest
from api.config import Settings
from pydantic import ValidationError
from pydantic_settings import SettingsConfigDict


class _TestSettings(Settings):
    model_config = SettingsConfigDict(env_file=None)


@pytest.mark.parametrize(
    "origin",
    (
        "",
        "http://api.essesion.shop",
        "https://api-project.a.run.app",
        "https://api.essesion.shop/path",
        "https://api.essesion.shop?redirect=other",
        "https://api.essesion.shop?",
        "https://api.essesion.shop#",
    ),
)
def test_nonlocal_public_api_origin_rejects_nonpublic_or_nonorigin_values(origin: str):
    with pytest.raises(ValidationError, match="PUBLIC_API_ORIGIN"):
        _TestSettings(env="staging", public_api_origin=origin)


def test_nonlocal_public_api_origin_accepts_and_normalizes_public_https_origin():
    settings = _TestSettings(
        env="staging",
        public_api_origin="https://api.essesion.shop/",
    )

    assert settings.public_api_origin == "https://api.essesion.shop"

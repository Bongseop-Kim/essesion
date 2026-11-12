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


def test_alt_site_origins_are_validated_and_normalized_like_public_api_origin():
    settings = _TestSettings(
        env="staging",
        public_api_origin="https://api.essesion.shop",
        alt_site_origins={"https://api.essesion.com/": "https://essesion.com/"},
    )

    assert settings.alt_site_origins == {"https://api.essesion.com": "https://essesion.com"}


@pytest.mark.parametrize(
    "pair",
    (
        {"http://api.essesion.com": "https://essesion.com"},
        {"https://api.essesion.com": "https://essesion.com/path"},
        {"https://api-project.a.run.app": "https://essesion.com"},
    ),
)
def test_alt_site_origins_reject_nonpublic_or_nonorigin_values(pair: dict[str, str]):
    with pytest.raises(ValidationError, match="ALT_SITE_ORIGINS"):
        _TestSettings(
            env="staging", public_api_origin="https://api.essesion.shop", alt_site_origins=pair
        )


def test_site_pair_returns_frontend_of_allowlisted_api_host_only():
    settings = _TestSettings(
        env="staging",
        public_api_origin="https://api.essesion.shop",
        frontend_origin="https://essesion.shop",
        alt_site_origins={"https://api.essesion.com": "https://essesion.com"},
    )

    assert settings.site_pair("api.essesion.com") == (
        "https://api.essesion.com",
        "https://essesion.com",
    )
    default = ("https://api.essesion.shop", "https://essesion.shop")
    assert settings.site_pair("api.essesion.shop") == default
    assert settings.site_pair("evil.example.com") == default
    assert settings.site_pair(None) == default

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
        "http://api.essesion.com",
        "https://api-project.a.run.app",
        "https://api.essesion.com/path",
        "https://api.essesion.com?redirect=other",
        "https://api.essesion.com?",
        "https://api.essesion.com#",
    ),
)
def test_nonlocal_public_api_origin_rejects_nonpublic_or_nonorigin_values(origin: str):
    with pytest.raises(ValidationError, match="PUBLIC_API_ORIGIN"):
        _TestSettings(env="staging", public_api_origin=origin)


def test_nonlocal_public_api_origin_accepts_and_normalizes_public_https_origin():
    settings = _TestSettings(
        env="staging",
        public_api_origin="https://api.essesion.com/",
    )

    assert settings.public_api_origin == "https://api.essesion.com"


def test_alt_site_origins_are_validated_and_normalized_like_public_api_origin():
    settings = _TestSettings(
        env="staging",
        public_api_origin="https://api.essesion.com",
        alt_site_origins={"https://api.essesion.shop/": "https://essesion.shop/"},
    )

    assert settings.alt_site_origins == {"https://api.essesion.shop": "https://essesion.shop"}


@pytest.mark.parametrize(
    "pair",
    (
        {"http://api.essesion.shop": "https://essesion.shop"},
        {"https://api.essesion.shop": "https://essesion.shop/path"},
        {"https://api-project.a.run.app": "https://essesion.shop"},
    ),
)
def test_alt_site_origins_reject_nonpublic_or_nonorigin_values(pair: dict[str, str]):
    with pytest.raises(ValidationError, match="ALT_SITE_ORIGINS"):
        _TestSettings(
            env="staging", public_api_origin="https://api.essesion.com", alt_site_origins=pair
        )


def test_site_pair_returns_frontend_of_allowlisted_api_host_only():
    settings = _TestSettings(
        env="staging",
        public_api_origin="https://api.essesion.com",
        frontend_origin="https://essesion.com",
        alt_site_origins={"https://api.essesion.shop": "https://essesion.shop"},
    )

    assert settings.site_pair("api.essesion.shop") == (
        "https://api.essesion.shop",
        "https://essesion.shop",
    )
    default = ("https://api.essesion.com", "https://essesion.com")
    assert settings.site_pair("api.essesion.com") == default
    assert settings.site_pair("evil.example.com") == default
    assert settings.site_pair(None) == default

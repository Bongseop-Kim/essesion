import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

EMAIL_MAX_LENGTH = 320
PASSWORD_MAX_LENGTH = 1024
PHONE_MAX_LENGTH = 32


class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=EMAIL_MAX_LENGTH)
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None
    name: str
    phone: str | None
    role: str
    birth: date | None
    phone_verified: bool
    notification_consent: bool
    notification_enabled: bool
    marketing_kakao_sms_consent: bool
    created_at: datetime


class PhoneSendRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=PHONE_MAX_LENGTH)


class PhoneVerifyRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=PHONE_MAX_LENGTH)
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class MessageResponse(BaseModel):
    message: str

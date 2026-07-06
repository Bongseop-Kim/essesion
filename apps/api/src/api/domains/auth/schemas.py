import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class LoginRequest(BaseModel):
    email: str
    password: str


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
    phone: str


class PhoneVerifyRequest(BaseModel):
    phone: str
    code: str


class MessageResponse(BaseModel):
    message: str

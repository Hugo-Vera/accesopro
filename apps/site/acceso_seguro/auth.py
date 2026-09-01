from __future__ import annotations
import datetime as dt
from typing import Any

import bcrypt as _bcrypt
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db

_oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def create_token(data: dict) -> str:
    payload = {**data, "exp": dt.datetime.utcnow() + dt.timedelta(minutes=settings.token_expire_minutes)}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def get_current_operator(token: str = Depends(_oauth2), db: Session = Depends(get_db)):
    from .models import Operador
    exc = HTTPException(status_code=401, detail="Token invalido", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        username = payload.get("sub")
        if not username:
            raise exc
    except JWTError:
        raise exc
    op = db.query(Operador).filter_by(username=username, activo=True).first()
    if not op:
        raise exc
    return op


def require_rol(*roles):
    def _dep(current=Depends(get_current_operator)):
        if current.rol not in roles:
            raise HTTPException(status_code=403, detail="Sin permisos")
        return current
    return _dep

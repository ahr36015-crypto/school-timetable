from dotenv import load_dotenv
import os

# Загружаем .env самым первым делом
load_dotenv()

from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from database import get_db, User

# Жестко задаем ключ (убираем пробелы и переносы строк)
SECRET_KEY = "my-super-secret-key-12345-abc"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 10080

print(f"✅ auth.py загружен. SECRET_KEY = '{SECRET_KEY}'")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password):
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()

    # ВАЖНО: преобразуем user_id в строку для JWT
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})

    token = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    print(f"🔐 ТОКЕН СОЗДАН: sub={to_encode.get('sub')}, тип={type(to_encode.get('sub'))}")
    return token


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Неверные учётные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")

        # Преобразуем user_id в int для запроса к БД
        if user_id is None:
            raise credentials_exception
        user_id = int(user_id)

        print(f"✅ Токен расшифрован: user_id={user_id}")
    except JWTError as e:
        print(f"❌ ОШИБКА JWT: {e}")
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        print(f"❌ Пользователь {user_id} не найден в БД")
        raise credentials_exception

    print(f"✅ Пользователь найден: {user.email}")
    return user
"""
Validador de formato de patentes por país.

Filtra lecturas que no correspondan a formatos reales de patentes
de los países seleccionados, eliminando falsos positivos como
"_1", "M_4", "144", etc.
"""
from __future__ import annotations
import re


# Patrones de patentes reales por país (ISO 3166-1 alpha-2)
# Cada patrón acepta con o sin guiones/espacios.
PLATE_PATTERNS: dict[str, list[re.Pattern]] = {
    # Argentina: vieja (AAA000) + Mercosur (AA000AA)
    "AR": [
        re.compile(r"^[A-Z]{2}\d{3}[A-Z]{2}$"),   # Mercosur: AA000AA
        re.compile(r"^[A-Z]{3}\d{3}$"),             # Vieja: AAA000
    ],
    # Brasil: vieja (AAA0000) + Mercosur (AAA0A00)
    "BR": [
        re.compile(r"^[A-Z]{3}\d[A-Z]\d{2}$"),     # Mercosur: AAA0A00
        re.compile(r"^[A-Z]{3}\d{4}$"),             # Vieja: AAA0000
    ],
    # Uruguay: vieja (AAA0000) + Mercosur (AA00000)
    "UY": [
        re.compile(r"^[A-Z]{2}\d{5}$"),             # Mercosur: AA00000
        re.compile(r"^[A-Z]{3}\d{4}$"),             # Vieja
    ],
    # Paraguay: Mercosur (AAAA000)
    "PY": [
        re.compile(r"^[A-Z]{4}\d{3}$"),             # Mercosur: AAAA000
        re.compile(r"^[A-Z]{3}\d{3}$"),             # Vieja
    ],
    # Chile: nueva (AABB00) + vieja (AA0000)
    "CL": [
        re.compile(r"^[A-Z]{4}\d{2}$"),             # Nueva: AABB00
        re.compile(r"^[A-Z]{2}\d{4}$"),             # Vieja: AA0000
        re.compile(r"^[A-Z]{3}\d{3}$"),             # Vieja moto/taxi
    ],
    # Colombia: Mercosur (AAA000A) + vieja (AAA000)
    "CO": [
        re.compile(r"^[A-Z]{3}\d{3}[A-Z]$"),       # Nueva
        re.compile(r"^[A-Z]{3}\d{3}$"),             # Vieja
    ],
    # México: 3+3+1 o 3+4
    "MX": [
        re.compile(r"^[A-Z0-9]{3}[A-Z0-9]{3,4}$"), # General
    ],
    # Venezuela
    "VE": [
        re.compile(r"^[A-Z]{2}\d{3}[A-Z]{2}$"),    # Mercosur
        re.compile(r"^[A-Z0-9]{7}$"),               # Varios formatos
    ],
    # EE.UU. (genérico, 4-8 alfanumérico)
    "US": [
        re.compile(r"^[A-Z0-9]{4,8}$"),
    ],
}

# Longitud mínima global (las patentes reales tienen al menos 5 caracteres)
_MIN_LEN = 5


def is_valid_plate(plate: str, countries: list[str]) -> bool:
    """
    Retorna True si la patente coincide con al menos un formato
    de alguno de los países indicados.
    """
    clean = re.sub(r"[\s\-_\.]", "", plate.upper())

    # Rechazar si es demasiado corto
    if len(clean) < _MIN_LEN:
        return False

    # Rechazar si empieza con _ o tiene caracteres raros
    if clean.startswith("_") or not re.match(r"^[A-Z0-9]+$", clean):
        return False

    for code in countries:
        patterns = PLATE_PATTERNS.get(code.upper(), [])
        for pat in patterns:
            if pat.match(clean):
                return True

    return False

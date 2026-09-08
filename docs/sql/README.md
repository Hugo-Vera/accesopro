# SQL AccesoPro (API)

El runtime de la API **sigue siendo SQLite** (`apps/api/data/accesopro.db`, libsql + Drizzle). Estos scripts son el mismo modelo para:

- documentar / restaurar SQLite
- crear el esquema en **PostgreSQL** o **MySQL/MariaDB** (Laragon) si más adelante se apunta `DATABASE_URL` a un server externo

| Archivo | Motor | Cómo aplicarlo |
|---------|--------|----------------|
| `accesopro.sqlite.sql` | SQLite | `sqlite3 apps/api/data/accesopro.db < docs/sql/accesopro.sqlite.sql` |
| `accesopro.postgres.sql` | PostgreSQL | `createdb accesopro` luego `psql -d accesopro -f docs/sql/accesopro.postgres.sql` |
| `accesopro.mysql.sql` | MySQL 8 / MariaDB | `CREATE DATABASE accesopro CHARACTER SET utf8mb4;` luego `mysql -u root accesopro < docs/sql/accesopro.mysql.sql` |

## Convención de tipos

| Concepto | SQLite | Postgres | MySQL |
|----------|--------|----------|--------|
| IDs | `TEXT` | `TEXT` | `VARCHAR(64)` |
| Fecha/hora | `INTEGER` epoch ms | `BIGINT` epoch ms | `BIGINT` epoch ms |
| Booleano | `INTEGER` 0/1 | `SMALLINT` 0/1 | `TINYINT(1)` 0/1 |
| JSON de catálogo | `TEXT` | `TEXT` | `TEXT` |

No se usa `TIMESTAMP` nativo: la API guarda milisegundos Unix.

## Qué no cubre este SQL

- **Motor ALPR** (`apps/site`, base `fastalpr`): es otro producto, otro esquema Postgres.
- **Datos demo**: los crea `seedIfEmpty()` al arrancar la API contra SQLite. En una base externa hay que sembrar aparte o migrar el `.db`.
- **Conectar la API a Postgres/MySQL**: hoy `apps/api/src/db/client.ts` solo abre libsql. Cambiar el driver es un trabajo aparte; el SQL ya deja el esquema listo.

Catálogo de tablas y columnas: [`docs/DATABASE.md`](../DATABASE.md).

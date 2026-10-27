"""
Servicio local de extracción e ingesta directa de sesiones desde la BD PostgreSQL de Lander Simulators.
Provee API REST para la app web TrackSIM ZERO.
"""
import io
import os
import sys
import csv
import unicodedata
from datetime import date, timedelta
import configparser
from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg2

app = Flask(__name__)
# Permitir peticiones desde Vite dev server (localhost:5173 u otros) y Firebase Hosting
CORS(app, resources={r"/*": {"origins": "*"}})

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.ini")

def get_db_params():
    """Lee parámetros de conexión desde config.ini."""
    if not os.path.exists(CONFIG_FILE):
        # Crear config por defecto si no existe
        cfg = configparser.ConfigParser()
        cfg['database'] = {
            'host': '192.168.153.2',
            'port': '5496',
            'database': 'landerlocaldb',
            'user': 'administrator',
            'password': 'landeraccess',
            'client_encoding': 'utf-8'
        }
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            cfg.write(f)

    cfg = configparser.ConfigParser()
    cfg.read(CONFIG_FILE, encoding='utf-8')
    if 'database' not in cfg:
        raise configparser.NoSectionError('database')
    return dict(cfg['database'])

def format_duration(seconds):
    if seconds is None:
        return "00:00:00"
    return str(timedelta(seconds=int(seconds)))

def slugify(value):
    value = unicodedata.normalize('NFKD', str(value or '')).encode('ascii', 'ignore').decode('ascii')
    value = "".join(c for c in value if c.isalnum() or c in (' ', '_')).strip()
    return value.replace(' ', '_')

def generate_csv_text_for_session(cursor, sesion_row, conn):
    """Genera el contenido CSV idéntico al emitido por streamdb.py para una sesión."""
    id_sesion, nombre_alumno, fecha, instructor, duracion, id_ejercicio, id_aula = sesion_row
    
    output = io.StringIO()
    escritor = csv.writer(output, delimiter=';', lineterminator='\r\n')
    
    # 1. Encabezado de sesión
    escritor.writerow(['Informe de sesión', ''])
    escritor.writerow([])

    # 2. Lección, Unidad y Ejercicio
    leccion, unidad, ejercicio = "N/A", "N/A", "N/A"
    try:
        cursor.execute("""
            SELECT edunits.sname AS edunit, lessons.sname AS lesson, exercises.sname AS exercise
            FROM sessions, exercises, lessons, idxexerciseslessons, edunits, idxlessonsedunits
            WHERE sessions.id = %s
              AND sessions.idexercise = exercises.id
              AND idxexerciseslessons.idexercise = exercises.id
              AND idxexerciseslessons.idlesson = lessons.id
              AND idxlessonsedunits.idlesson = lessons.id
              AND idxlessonsedunits.idedunit = edunits.id
        """, (id_sesion,))
        info_ejercicio = cursor.fetchone()
        if info_ejercicio:
            leccion, unidad, ejercicio = info_ejercicio[0], info_ejercicio[1], info_ejercicio[2]
        else:
            cursor.execute("SELECT sname FROM sessions WHERE id = %s", (id_sesion,))
            sname_row = cursor.fetchone()
            if sname_row and sname_row[0]:
                parts = [p.strip() for p in sname_row[0].split('\n') if p.strip()]
                if len(parts) >= 3:
                    leccion, unidad, ejercicio = parts[0], parts[1], parts[2]
                elif len(parts) == 2:
                    leccion, unidad = parts[0], parts[1]
                elif len(parts) == 1:
                    leccion = parts[0]
    except Exception:
        conn.rollback()

    escritor.writerow(['Lección', 'Unidad', 'Ejercicio'])
    escritor.writerow([leccion, unidad, ejercicio])
    escritor.writerow([])
    
    fecha_str = fecha.strftime("%Y-%m-%d") if hasattr(fecha, 'strftime') else str(fecha)
    escritor.writerow(['FECHA', 'CONDUCTOR', 'INSTRUCTOR', 'DURACIÓN'])
    escritor.writerow([fecha_str, instructor or "-", nombre_alumno or "-", format_duration(duracion)])
    escritor.writerow([])

    # 3. Condiciones iniciales
    escritor.writerow([])
    escritor.writerow(['Condiciones iniciales', ''])
    escritor.writerow([])
    try:
        cursor.execute("""
            SELECT
                substring(sessionsextradata.sdescription from '[^:]+'),
                sessionsextradata.svalue
            FROM idxsessionsextradatasessions, sessionsextradata
            WHERE idxsessionsextradatasessions.idsessionsextradata = sessionsextradata.id
              AND idxsessionsextradatasessions.idsession = %s
              AND idxsessionsextradatasessions.IdAulaSession = %s
        """, (id_sesion, id_aula))
        for descripcion, valor in cursor.fetchall():
            escritor.writerow([(descripcion or '') + ':', valor or ''])
    except Exception:
        conn.rollback()
    escritor.writerow([])

    # 4. Comentarios
    comentarios = ""
    try:
        cursor.execute("""
            SELECT exercises.scomments
            FROM sessions, exercises
            WHERE sessions.idexercise = exercises.id
              AND sessions.id = %s
        """, (id_sesion,))
        r = cursor.fetchone()
        if r and r[0]:
            comentarios = r[0]
    except Exception:
        conn.rollback()
    escritor.writerow(['Comentarios', ''])
    escritor.writerow([comentarios])
    escritor.writerow([])

    # 5. Palabras clave
    palabras_clave = ""
    try:
        cursor.execute("""
            SELECT exercises.stags
            FROM sessions, exercises
            WHERE sessions.idexercise = exercises.id
              AND sessions.id = %s
        """, (id_sesion,))
        r = cursor.fetchone()
        if r and r[0]:
            palabras_clave = r[0]
    except Exception:
        conn.rollback()
    escritor.writerow(['Palabras clave del ejercicio', ''])
    escritor.writerow([palabras_clave])
    escritor.writerow([])

    # 6. Notas del instructor
    notas = ""
    try:
        cursor.execute("SELECT instructornotes FROM sessions WHERE id = %s", (id_sesion,))
        r = cursor.fetchone()
        if r and r[0]:
            notas = r[0]
    except Exception:
        try:
            cursor.execute("SELECT sinstructornotes FROM sessions WHERE id = %s", (id_sesion,))
            r = cursor.fetchone()
            if r and r[0]:
                notas = r[0]
        except Exception:
            conn.rollback()
    escritor.writerow(['Notas del instructor', ''])
    escritor.writerow([notas])
    escritor.writerow([])

    # 7. Marcas
    escritor.writerow([])
    escritor.writerow(['Marcas', ''])
    escritor.writerow([])
    try:
        cursor.execute("""
            SELECT marks.ncicle*sessions.dcicleperiod/1000.0 AS tiempo,
                   marks.stipo,
                   marks.scomment
            FROM sessions, marks, idxmarkssessions
            WHERE sessions.id = %s
              AND sessions.IdAula = %s
              AND idxmarkssessions.idsession = sessions.id
              AND idxmarkssessions.idmark = marks.id
            ORDER BY marks.ncicle ASC
        """, (id_sesion, id_aula))
        for tiempo, tipo, comentario in cursor.fetchall():
            escritor.writerow([format_duration(tiempo), tipo, comentario])
    except Exception:
        conn.rollback()
    escritor.writerow([])

    # 8. Resumen de marcas
    escritor.writerow([])
    escritor.writerow(['Resumen de marcas', ''])
    escritor.writerow([])
    try:
        cursor.execute("""
            SELECT marks.stipo, marks.scomment, COUNT(marks.id)
            FROM marks, idxmarkssessions, sessions
            WHERE idxmarkssessions.idsession = sessions.id
              AND idxmarkssessions.idmark = marks.id
              AND sessions.id = %s
              AND sessions.IdAula = %s
              AND sessions.ncicles*sessions.dcicleperiod > 0
            GROUP BY marks.stipo, marks.scomment
            ORDER BY marks.stipo, COUNT(marks.id) DESC
        """, (id_sesion, id_aula))
        resumen_rows = cursor.fetchall()
        
        from collections import defaultdict
        resumen_por_tipo = defaultdict(list)
        for tipo, comentario, cantidad in resumen_rows:
            resumen_por_tipo[tipo].append((comentario, cantidad))
        
        tipos_ordenados = [
            ('ERROR', 'Errores'),
            ('BREAKDOWN', 'Averias'),
            ('START EVENT', 'Incidencias'),
            ('MARK', 'Marcas'),
            ('WEATHER', 'Eventos de clima'),
            ('ILLUMINATION', 'Eventos de iluminacion'),
            ('TRAFFIC', 'Eventos de trafico'),
            ('START COMM', 'Comunicaciones'),
            ('ENDING', 'Desenlaces'),
            ('INFO', 'Mensajes de informacion'),
            ('STUDENT MARK', 'Marcas de alumno'),
            ('MESSAGE', 'Mensajes'),
            ('TRAIN_LOAD', 'Evento de carga de tren'),
            ('TRAFFIC_CONDS', 'Evento de condiciones de trafico'),
            ('PULSADOR', 'Pulsador')
        ]
        
        tiene_marcas = False
        for tipo_db, tipo_es in tipos_ordenados:
            if tipo_db in resumen_por_tipo:
                tiene_marcas = True
                escritor.writerow([tipo_es, ''])
                for comentario, cantidad in resumen_por_tipo[tipo_db]:
                    escritor.writerow([comentario, cantidad])
                escritor.writerow([])
        
        if not tiene_marcas:
            escritor.writerow(['La sesion no contiene marcas'])
            escritor.writerow([])
    except Exception:
        conn.rollback()
    escritor.writerow([])

    # 9. Indicadores genéricos
    escritor.writerow([])
    escritor.writerow(['Indicadores genéricos', ''])
    escritor.writerow([])
    try:
        cursor.execute("""
            SELECT
                genericindics.sdescription,
                substring(genericindics.svalue from '[0-9.:]+') AS value,
                substring(genericindics.svalue from '[^0-9.:].*') AS unit
            FROM idxgenindicssessions, genericindics
            WHERE idxgenindicssessions.idgenindics = genericindics.id
              AND idxgenindicssessions.idsession = %s
        """, (id_sesion,))
        for descripcion, valor, unidad in cursor.fetchall():
            escritor.writerow([descripcion, valor or '', unidad or ''])
    except Exception:
        conn.rollback()

    alumno_limpio = slugify(nombre_alumno)
    filename = f"ID{id_sesion}_{alumno_limpio}_{fecha_str}.csv"
    return filename, output.getvalue()

@app.route("/api/status", methods=["GET"])
def get_status():
    """Verifica si el servicio local está activo y si puede conectarse a la BD de Lander."""
    config = {}
    try:
        config = get_db_params()
    except Exception as e:
        return jsonify({"service": "running", "db_connected": False, "error": f"Config error: {e}"})

    safe_config = {
        "host": config.get("host"),
        "port": config.get("port"),
        "database": config.get("database"),
        "user": config.get("user"),
    }

    try:
        conn = psycopg2.connect(**config, connect_timeout=3)
        conn.close()
        return jsonify({"service": "running", "db_connected": True, "config": safe_config})
    except Exception as e:
        return jsonify({
            "service": "running",
            "db_connected": False,
            "config": safe_config,
            "error": str(e)
        })

@app.route("/api/config", methods=["GET", "POST"])
def manage_config():
    """Lee o actualiza la configuración de la BD (host, port, user, etc.)."""
    if request.method == "GET":
        try:
            params = get_db_params()
            safe_params = {**params, "password": "••••••••" if params.get("password") else ""}
            return jsonify({"ok": True, "config": safe_params})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500

    data = request.json or {}
    cfg = configparser.ConfigParser()
    if os.path.exists(CONFIG_FILE):
        cfg.read(CONFIG_FILE, encoding='utf-8')
    if 'database' not in cfg:
        cfg['database'] = {}

    for k in ['host', 'port', 'database', 'user', 'client_encoding']:
        if k in data and data[k]:
            cfg['database'][k] = str(data[k]).strip()
    if 'password' in data and data['password'] and data['password'] != '••••••••':
        cfg['database']['password'] = str(data['password']).strip()

    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        cfg.write(f)

    return jsonify({"ok": True, "message": "Configuración guardada exitosamente"})

@app.route("/api/sessions/count", methods=["GET"])
def count_sessions():
    """Cuenta sesiones en un rango de fechas."""
    fecha_inicio = request.args.get("inicio", date.today().isoformat())
    fecha_fin = request.args.get("fin", date.today().isoformat())
    include_anon = request.args.get("anon", "false").lower() == "true"

    try:
        conn_params = get_db_params()
        conn = psycopg2.connect(**conn_params, connect_timeout=5)
        cursor = conn.cursor()

        query_base = """
            SELECT COUNT(*) as total
            FROM sessions 
            WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN %s AND %s
        """
        params = [fecha_inicio, fecha_fin]
        if not include_anon:
            query_base += " AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')"

        cursor.execute(query_base, params)
        total = cursor.fetchone()[0]

        min_date, max_date = None, None
        if total > 0:
            query_dates = """
                SELECT MIN(CAST(dtcreation AS DATE)), MAX(CAST(dtcreation AS DATE))
                FROM sessions 
                WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN %s AND %s
            """
            if not include_anon:
                query_dates += " AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')"
            cursor.execute(query_dates, params)
            r = cursor.fetchone()
            if r:
                min_date = str(r[0]) if r[0] else None
                max_date = str(r[1]) if r[1] else None

        conn.close()
        return jsonify({
            "ok": True,
            "total": total,
            "min_date": min_date,
            "max_date": max_date,
            "fecha_inicio": fecha_inicio,
            "fecha_fin": fecha_fin
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/api/sessions/extract", methods=["POST"])
def extract_sessions():
    """Extrae las sesiones de la BD y devuelve la lista con filename y csv_content para cada una."""
    body = request.json or {}
    fecha_inicio = body.get("inicio", date.today().isoformat())
    fecha_fin = body.get("fin", date.today().isoformat())
    include_anon = bool(body.get("anon", False))
    limit = int(body.get("limit", 200))

    try:
        conn_params = get_db_params()
        conn = psycopg2.connect(**conn_params, connect_timeout=8)
        cursor = conn.cursor()

        query_base = """
            SELECT id, sstudentname, dtcreation, 
                   sinstructorname, (ncicles * dcicleperiod / 1000.0) as duration,
                   idexercise, idaula
            FROM sessions 
            WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN %s AND %s
        """
        params = [fecha_inicio, fecha_fin]
        if not include_anon:
            query_base += " AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')"
        query_base += f" ORDER BY dtcreation DESC LIMIT {limit};"

        cursor.execute(query_base, params)
        sesiones = cursor.fetchall()

        results = []
        for s in sesiones:
            try:
                fname, csv_data = generate_csv_text_for_session(cursor, s, conn)
                results.append({
                    "id": s[0],
                    "driver": s[1],
                    "date": s[2].strftime("%Y-%m-%d") if hasattr(s[2], 'strftime') else str(s[2]),
                    "filename": fname,
                    "csv": csv_data
                })
            except Exception as item_err:
                conn.rollback()
                results.append({
                    "id": s[0],
                    "driver": s[1],
                    "error": str(item_err)
                })

        conn.close()
        return jsonify({"ok": True, "extracted": len(results), "sessions": results})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("STREAMDB_PORT", 5005))
    print(f"[*] Iniciando servidor StreamDB API en http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)

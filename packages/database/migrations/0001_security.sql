-- Seguridad multi-tenant: contexto de sesión, rol de la aplicación y Row Level Security.
--
-- La API se conecta con el rol `brisas_app`, que NO es dueño de las tablas y por eso
-- queda sujeto a RLS. En cada transacción la API declara su contexto con:
--   set_config('app.tenant_id', '<uuid>', true)   conjunto sobre el que opera
--   set_config('app.user_id',   '<uuid>', true)   usuario autenticado
--   set_config('app.scope',     'tenant' | 'platform' | 'system', true)
-- RLS es una segunda barrera: aunque una consulta olvide filtrar por tenant_id,
-- la base de datos solo devuelve filas del conjunto declarado.

CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.tenant_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
-- platform: operaciones del SuperAdmin. system: autenticación y trabajos en segundo plano.
CREATE OR REPLACE FUNCTION app.is_privileged() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(current_setting('app.scope', true), '') IN ('platform', 'system') $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'brisas_app') THEN
    CREATE ROLE brisas_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- Aplica (o reaplica) políticas y permisos. Se ejecuta después de cada migración para
-- que toda tabla nueva con columna tenant_id quede protegida sin depender de la memoria
-- de quien la creó.
CREATE OR REPLACE FUNCTION app.apply_security() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', target.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (tenant_id = app.tenant_id() OR app.is_privileged())
         WITH CHECK (tenant_id = app.tenant_id() OR app.is_privileged())',
      target.table_name
    );
  END LOOP;

  -- El conjunto solo puede leerse a sí mismo; crear o modificar conjuntos es de plataforma.
  ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenants_read ON public.tenants;
  CREATE POLICY tenants_read ON public.tenants FOR SELECT
    USING (id = app.tenant_id() OR app.is_privileged());
  DROP POLICY IF EXISTS tenants_write ON public.tenants;
  CREATE POLICY tenants_write ON public.tenants
    USING (app.is_privileged()) WITH CHECK (app.is_privileged());

  -- Los roles y plantillas del sistema (tenant_id nulo) son de lectura para todos.
  DROP POLICY IF EXISTS system_rows_read ON public.roles;
  CREATE POLICY system_rows_read ON public.roles FOR SELECT USING (tenant_id IS NULL);
  DROP POLICY IF EXISTS system_rows_read ON public.notification_templates;
  CREATE POLICY system_rows_read ON public.notification_templates FOR SELECT USING (tenant_id IS NULL);

  GRANT USAGE ON SCHEMA public TO brisas_app;
  GRANT USAGE ON SCHEMA app TO brisas_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brisas_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO brisas_app;

  -- Historiales inmutables: la aplicación solo puede insertar y leer.
  REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM brisas_app;
  REVOKE UPDATE, DELETE, TRUNCATE ON public.pqr_status_history FROM brisas_app;
  -- Los catálogos globales se administran solo con migraciones.
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.permissions FROM brisas_app;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.plans FROM brisas_app;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.role_permissions FROM brisas_app;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.apply_security() FROM PUBLIC;
--> statement-breakpoint
SELECT app.apply_security();

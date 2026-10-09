-- Isolated PostgreSQL test fixture only. Never execute on production.
CREATE TABLE public.permissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 key text NOT NULL UNIQUE,
 description text
);
CREATE TABLE public.roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.role_permissions (role_id uuid, permission_id uuid);
CREATE TABLE public.member_permissions (organization_member_id uuid, permission_id uuid, effect text);
INSERT INTO public.permissions(key,description) VALUES ('settings.edit','Edit tenant settings');
INSERT INTO public.roles DEFAULT VALUES;

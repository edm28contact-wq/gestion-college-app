
create table public.kitchen_pms_plan (
 code text primary key check(length(code) between 2 and 60),
 title text not null check(length(title) between 3 and 120),
 category text not null,
 applicable text not null default 'pending' check(applicable in ('pending','yes','no')),
 responsible text not null default '',
 procedure_ref text not null default '',
 frequency text not null default '',
 next_review date,
 justification text not null default '',
 reviewed_by text,
 reviewed_at timestamptz,
 revision integer not null default 0 check(revision>=0),
 check(applicable='pending' or (length(btrim(responsible))>0 and length(btrim(justification))>0 and (applicable='no' or (length(btrim(procedure_ref))>0 and length(btrim(frequency))>0 and next_review is not null))))
);
create table public.kitchen_pms_plan_history (
 code text not null references public.kitchen_pms_plan(code) on delete restrict,
 revision integer not null,
 snapshot jsonb not null,
 primary key(code,revision)
);
create table public.kitchen_pms_records (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 code text not null references public.kitchen_pms_plan(code) on delete restrict,
 plan_revision integer not null,
 observed_at timestamptz not null,
 recorded_at timestamptz not null default now(),
 recorded_by text not null,
 actor_name text not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 result text not null check(result in ('recorded','within_limits','alert','review')),
 reasons text[] not null default '{}',
 corrective_action text,
 evidence_ref text,
 next_due date,
 check(result<>'alert' or length(btrim(coalesce(corrective_action,'')))>=3)
);
create index kitchen_pms_records_date_idx on public.kitchen_pms_records(observed_at desc,id);
create index kitchen_pms_records_code_idx on public.kitchen_pms_records(code,observed_at desc);
create table public.kitchen_pms_followups (
 id uuid primary key default gen_random_uuid(),
 record_id uuid not null references public.kitchen_pms_records(id) on delete restrict,
 action text not null check(action in ('followup','closed','reopened')),
 note text not null check(length(btrim(note)) between 3 and 4000),
 evidence_ref text,
 actor text not null,
 actor_name text not null,
 recorded_at timestamptz not null default now()
);
create index kitchen_pms_followups_record_idx on public.kitchen_pms_followups(record_id,recorded_at desc,id);
alter table public.kitchen_pms_plan enable row level security;
alter table public.kitchen_pms_plan_history enable row level security;
alter table public.kitchen_pms_records enable row level security;
alter table public.kitchen_pms_followups enable row level security;
revoke all on public.kitchen_pms_plan,public.kitchen_pms_plan_history,public.kitchen_pms_records,public.kitchen_pms_followups from public,anon,authenticated,service_role;
grant select,update on public.kitchen_pms_plan to service_role;
grant select,insert on public.kitchen_pms_plan_history,public.kitchen_pms_records,public.kitchen_pms_followups to service_role;
insert into public.kitchen_pms_plan(code,title,category) values
 ('pms','Organisation, déclaration sanitaire, analyse des dangers et PMS','Organisation'),
 ('training','Formation, hygiène du personnel et culture de sécurité alimentaire','Hygiène'),
 ('premises','Locaux, marche en avant, eau, équipements et maintenance','Hygiène'),
 ('cleaning','Plan de nettoyage et désinfection','Hygiène'),
 ('pests','Lutte contre les nuisibles','Hygiène'),
 ('waste','Déchets et excédents','Hygiène'),
 ('delivery','Réception des denrées et fournisseurs','Production'),
 ('storage','Stockage, DLC et séparation des denrées','Production'),
 ('coldchain','Chambres froides et surgelés','Production'),
 ('preparation','Préparation, décongélation et contaminations croisées','Production'),
 ('cooking','Cuisson selon procédure validée','Production'),
 ('reheating','Remise en température','Production'),
 ('cooling','Refroidissement rapide','Production'),
 ('hotservice','Distribution chaude','Production'),
 ('coldservice','Distribution froide','Production'),
 ('samples','Plats témoins','Traçabilité'),
 ('traceability','Menus, recettes, lots et traçabilité','Traçabilité'),
 ('allergens','Allergènes et information des convives','Traçabilité'),
 ('metrology','Vérification des thermomètres et enregistreurs','Vérification'),
 ('microbiology','Autocontrôles microbiologiques','Vérification'),
 ('incident','Anomalies, retraits, rappels et TIAC','Vérification'),
 ('audit','Revue du PMS et vérification de l’efficacité','Vérification');

create function public.kitchen_pms_update_plan(p_code text,p_revision integer,p_config jsonb,p_actor text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.kitchen_pms_plan%rowtype;
begin
 select * into r from public.kitchen_pms_plan where code=p_code for update;
 if not found then return jsonb_build_object('error','Rubrique introuvable','status',404); end if;
 if r.revision<>p_revision then return jsonb_build_object('error','Paramétrage modifié simultanément. Actualisez.','status',409);end if;
 update public.kitchen_pms_plan set applicable=p_config->>'applicable',responsible=p_config->>'responsible',procedure_ref=p_config->>'procedure_ref',frequency=p_config->>'frequency',next_review=nullif(p_config->>'next_review','')::date,justification=p_config->>'justification',reviewed_by=p_actor,reviewed_at=now(),revision=revision+1 where code=p_code returning * into r;
 insert into public.kitchen_pms_plan_history(code,revision,snapshot) values(r.code,r.revision,to_jsonb(r));
 return jsonb_build_object('plan',to_jsonb(r));
end $$;
create function public.kitchen_pms_open_alerts() returns table(id uuid,code text,observed_at timestamptz,reasons text[],corrective_action text,actor_name text)
language sql stable security invoker set search_path='' as $$
 select r.id,r.code,r.observed_at,r.reasons,r.corrective_action,r.actor_name
 from public.kitchen_pms_records r
 left join lateral(select f.action from public.kitchen_pms_followups f where f.record_id=r.id and f.action in ('closed','reopened') order by f.recorded_at desc,f.id desc limit 1) last_action on true
 where r.result in ('alert','review') and coalesce(last_action.action,'')<>'closed'
 order by r.observed_at desc,r.id
$$;
create function public.kitchen_pms_followup(p_id uuid,p_action text,p_note text,p_evidence text,p_actor text,p_name text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.kitchen_pms_records%rowtype; state text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,29));
 select * into r from public.kitchen_pms_records where id=p_id;
 if not found or r.result not in ('alert','review') then return jsonb_build_object('error','Dossier à vérifier introuvable','status',404);end if;
 select action into state from public.kitchen_pms_followups where record_id=p_id and action in ('closed','reopened') order by recorded_at desc,id desc limit 1;
 if (p_action='closed' and state='closed') or (p_action='reopened' and state is distinct from 'closed') then return jsonb_build_object('error','État déjà modifié','status',409);end if;
 if p_action not in ('followup','closed','reopened') or length(btrim(coalesce(p_note,'')))<3 or (p_action in ('closed','reopened') and length(btrim(coalesce(p_evidence,'')))<3) then return jsonb_build_object('error','Motif et preuve de vérification nécessaires','status',400);end if;
 insert into public.kitchen_pms_followups(record_id,action,note,evidence_ref,actor,actor_name) values(p_id,p_action,p_note,p_evidence,p_actor,p_name);
 return jsonb_build_object('saved',true);
end $$;
revoke all on function public.kitchen_pms_update_plan(text,integer,jsonb,text),public.kitchen_pms_open_alerts(),public.kitchen_pms_followup(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.kitchen_pms_update_plan(text,integer,jsonb,text),public.kitchen_pms_open_alerts(),public.kitchen_pms_followup(uuid,text,text,text,text,text) to service_role;
notify pgrst,'reload schema';

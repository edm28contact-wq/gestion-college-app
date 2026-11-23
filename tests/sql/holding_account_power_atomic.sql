-- Test transactionnel : création du compte, permissions directes et pouvoirs.
-- Exécuter dans une connexion privilégiée (service_role).
-- Toutes les données de test sont annulées.
begin;
set local role service_role;
do $test$
declare
  test_id uuid;
  permission_id uuid;
  effective jsonb;
  direct jsonb;
begin
  insert into public.admin_access_powers(code,name,permissions)
  values ('qa_unique_editor','QA : pouvoir temporaire','{"college.salaires.read":true}'::jsonb)
  returning id into permission_id;

  select public.holding_save_account_with_powers(
    'qa_unique_editor_1123',
    '{"role":"admin_limited","display_name":"Utilisateur QA","active":true,"must_change_password":true,"permissions":{"readonly":true},"password_hash":"qa_not_real","password_salt":"qa_not_real","password_iterations":310000}'::jsonb,
    array[permission_id]
  ) into test_id;

  select permissions,direct_permissions into effective,direct
  from public.admin_accounts where id=test_id;
  if effective->>'college.salaires.read' <> 'true'
    or effective->>'readonly' <> 'true'
    or direct ? 'college.salaires.read'
  then
    raise exception 'Droits effectifs incorrects après création';
  end if;

  perform public.holding_save_account_with_powers(
    'qa_unique_editor_1123',
    '{"role":"admin_limited","display_name":"QA mise à jour","active":true,"must_change_password":false,"permissions":{"readonly":true}}'::jsonb,
    array[]::uuid[]
  );
  select permissions into effective
  from public.admin_accounts where id=test_id;
  if effective ? 'college.salaires.read' or effective->>'readonly' <> 'true'
    or exists(select 1 from public.admin_access_assignments where account_id=test_id)
  then
    raise exception 'Révocation du pouvoir incorrecte';
  end if;

  begin
    perform public.holding_save_account_with_powers(
      'qa_unique_editor_1123',
      '{"role":"admin_limited","display_name":"Modification interdite","active":true,"permissions":{}}'::jsonb,
      array['00000000-0000-0000-0000-000000000001'::uuid]
    );
    raise exception 'Pouvoir inconnu accepté';
  exception when others then
    if sqlerrm = 'Pouvoir inconnu accepté' then raise; end if;
  end;
  if (select display_name from public.admin_accounts where id=test_id) <> 'QA mise à jour' then
    raise exception 'Mise à jour partielle détectée';
  end if;
end
$test$;
rollback;

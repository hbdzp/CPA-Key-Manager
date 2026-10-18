const CONCURRENCY_OPTIONS = [0, 1, 2, 3, 5, 10, 20, 50];
const CUSTOM_CONCURRENCY = "__custom__";

async function copyAPIKey(button, view) {
  button.disabled = true;
  try {
    const keys = await fetchConfiguredAPIKeys();
    let key = "";
    for (const value of keys) {
      const candidate = value.trim();
      const scope = await sha256Hex(CALLER_SCOPE_SALT + candidate);
      if (scope === view.scope) {
        key = candidate;
        break;
      }
    }
    if (!key) throw new UIError(m("ui.this_api_key_no_longer_exists_refresh_the_list"));
    await copyText(key);
    button.classList.add("copied");
    setActionIcon(button, "check", m("ui.copied"));
    setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove("copied");
      setActionIcon(button, "copy", m("ui.copy_api_key"));
    }, 2000);
  } finally { button.disabled = false; }
}

async function saveConcurrency(view, raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) throw new UIError(m("ui.concurrency_limit_must_be_an_integer_from_0_to_10000"));
  const limit = Number(text);
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10000) {
    throw new UIError(m("ui.concurrency_limit_must_be_an_integer_from_0_to_10000"));
  }
  await submitKeyChange(view.scope, async () => {
    await mutateAdmin("POST", "/keys/concurrency", { scope: view.scope, concurrency_limit: limit });
    notify(limit ? m("ui.concurrency_limit_updated_to_value", { v0: limit }) : m("ui.concurrency_limit_removed"));
  });
}

async function submitKeyChange(scope, save) {
  const owner = adminUIState;
  if (owner.keySubmissions.has(scope)) return;
  owner.keySubmissions.add(scope);
  renderKeys();
  try { await save(); } finally {
    owner.keySubmissions.delete(scope);
    if (owner === adminUIState) renderKeys();
  }
}

function keyMatchesGroup(view, groupFilter) {
  if (!groupFilter) return true;
  const ids = view.group_ids || [];
  if (groupFilter === "__ungrouped__") return !ids.length;
  return ids.includes(groupFilter);
}

function renderGroupFilter(select, groups, ungroupedValue = "__ungrouped__") {
  const current = select.value;
  select.replaceChildren(
    el("option", { value: "", text: m("ui.fork_all_groups") }),
    el("option", { value: ungroupedValue, text: m("ui.fork_ungrouped") }),
    ...groups.map((group) => el("option", { value: group.id, text: displayLabel(group.name || group.id) }))
  );
  select.value = [...select.options].some((option) => option.value === current) ? current : "";
}

function filteredKeys() {
  if (!resources.admin.keys.value) return [];
  const filter = $("key-filter").value.trim().toLowerCase();
  const groupFilter = $("key-group-filter").value;
  return resources.admin.keys.value.filter((key) => !key.deleted_at || $("keys-include-deleted").checked)
    .filter((view) => keyMatchesGroup(view, groupFilter))
    .filter((view) =>
      matchesTerm([apiKeyIdentity(view).text, view.plan_name, ...(view.group_names || []), view.scope].filter(Boolean).join(" "), filter)
    );
}

function renderKeySelection() {
  const visible = filteredKeys().filter((view) => !view.deleted_at);
  const selected = adminUIState.selectedKeys;
  const allVisible = visible.length > 0 && visible.every((view) => selected.has(view.scope));
  $("keys-select-visible").checked = allVisible;
  $("keys-select-visible").disabled = !visible.length;
  setText($("keys-selection-count"), m("ui.fork_value_selected", { v0: selected.size }));
  $("keys-selection-clear").disabled = !selected.size;
  $("keys-edit-groups").disabled = !selected.size;
}

function renderKeys() {
  if (currentRole !== "admin" || activeTab(false) !== "keys") return false;
  closeHoverTooltip();
  if (renderDataPending($("keys-body"), [resources.admin.keys], m("ui.loading"), "empty section-loading")) return;
  const plans = resources.admin.plans.value;
  const groups = resources.admin.groups.value;
  renderGroupFilter($("key-group-filter"), groups || []);
  for (const scope of [...adminUIState.selectedKeys]) {
    const entry = resources.admin.keys.value.find((item) => item.scope === scope);
    if (!entry || entry.deleted_at) adminUIState.selectedKeys.delete(scope);
  }
  const keys = filteredKeys();
  renderKeySelection();
  renderCollection($("keys-body"), keys, {
    headers: [
      m("ui.fork_select"),
      "API Key",
      m("ui.fork_groups"),
      m("ui.subscription_plans"),
      m("ui.routing_rules"),
      m("ui.concurrency_limit"),
      m("ui.subscription_quota"),
      m("ui.status"),
      m("ui.actions")
    ],
    render: (view) => {
      const deleted = !!view.deleted_at;
      const saving = adminUIState.keySubmissions.has(view.scope);
      const name = apiKeyIdentity(view).primary;
      const select = el(
        "select",
        {
          name: "plan_id",
          disabled: deleted || saving || !plans,
          "data-tip": !plans ? resources.admin.plans.error || m("ui.loading_subscription_plans") : null,
          "aria-label": m("ui.subscription_plan_for_value", { v0: name }),
          onchange: (event) =>
            guard(async () => {
              const planID = event.target.value;
              event.target.value = view.plan_id || "";
              await submitKeyChange(view.scope, async () => {
                if (planID) await mutateAdmin("POST", "/keys/bind", { scope: view.scope, plan_id: planID });
                else await mutateAdmin("POST", "/keys/unbind", { scope: view.scope });
                notify(m("ui.subscription_plan_updated"));
              });
            })
        },
        el("option", { value: "", text: m("ui.unlimited") }),
        view.plan_id && !(plans || []).some((plan) => plan.id === view.plan_id)
          ? el("option", { value: view.plan_id, selected: true, text: displayLabel(view.plan_name || view.plan_id) })
          : null,
        (plans || []).map((plan) => el("option", { value: plan.id, selected: plan.id === view.plan_id }, displayLabel(plan.name || plan.id))
        )
      );

      const usage = renderQuotaWindows(view);

      const currentConcurrencyLimit = Number(view.concurrency_limit || 0);
      const concurrencyValues = CONCURRENCY_OPTIONS.includes(currentConcurrencyLimit)
        ? CONCURRENCY_OPTIONS
        : [...CONCURRENCY_OPTIONS, currentConcurrencyLimit].sort((a, b) => a - b);
      const concurrencySelect = el(
        "select",
        {
          "aria-label": m("ui.maximum_concurrent_requests_for_value", { v0: name }),
          disabled: deleted || saving,
          "data-tip": m("ui.maximum_concurrent_requests_0_means_unlimited"),
          onchange: (event) =>
            guard(async () => {
              const value = event.target.value;
              event.target.value = String(currentConcurrencyLimit);
              if (value === CUSTOM_CONCURRENCY) {
                openActionDialog(
                  m("ui.set_concurrency_limit"),
                  m("ui.enter_an_integer_from_0_to_10000_use_0_for_unlimited"),
                  String(currentConcurrencyLimit),
                  (raw) => saveConcurrency(view, raw)
                );
                return;
              }
              await saveConcurrency(view, value);
            })
        },
        concurrencyValues.map((limit) =>
          el("option", {
            value: String(limit),
            selected: limit === currentConcurrencyLimit,
            text: limit === 0 ? m("ui.unlimited") : String(limit)
          })
        ),
        el("option", { value: CUSTOM_CONCURRENCY, text: m("ui.enter_manually") })
      );
      const concurrency = el(
        "div",
        { class: "concurrency-editor" },
        el("span", { class: "native-select" }, concurrencySelect),
        el("span", { class: "small muted", text: m("ui.current_value", { v0: int(view.current_concurrency) }) })
      );
      const groupChips = (view.group_ids || []).map((id, index) => {
        const group = (groups || []).find((entry) => entry.id === id);
        const disabledGroup = group ? group.enabled === false : false;
        const unauthorizedGroup = group ? !groupGrantsAccess(group) : false;
        return {
          text: view.group_names?.[index] || group?.name || id,
          tag: disabledGroup ? m("ui.disabled") : unauthorizedGroup ? m("ui.fork_no_credentials") : ""
        };
      });
      const groupsCell = el(
        "div",
        { class: "key-group-cell" },
        groupChips.length ? settingsChipList(groupChips) : el("span", { class: "muted small", text: m("ui.fork_ungrouped") }),
        el(
          "div",
          { class: "compact-actions" },
          el("button", {
            type: "button",
            class: "link",
            text: m("ui.fork_set_groups"),
            disabled: deleted || saving,
            onclick: () => guard(() => editKeyGroups([view.scope]))
          })
        )
      );

      return el(
        "tr",
        { class: deleted ? "key-deleted" : "" },
        el(
          "td",
          {},
          checkboxControl({
            input: el("input", {
              type: "checkbox",
              checked: adminUIState.selectedKeys.has(view.scope),
              disabled: deleted,
              "aria-label": m("ui.fork_select_value", { v0: name }),
              onchange: (event) => {
                if (event.target.checked) adminUIState.selectedKeys.add(view.scope); else adminUIState.selectedKeys.delete(view.scope);
                renderKeySelection();
              }
            })
          })
        ),
        el(
          "td",
          {},
          renderAPIKeyIdentity(view, {
            stacked: true,
            trailing: [
              el(
                "button",
                {
                  class: "key-copy-button link",
                  type: "button",
                  disabled: deleted || !view.in_config,
                  "data-tip": m("ui.copy_api_key"),
                  "aria-label": m("ui.copy_api_key"),
                  onclick: (event) => guard(() => copyAPIKey(event.currentTarget, view))
                },
                actionIcon("copy")
              ),
              !deleted && !view.in_config ? el("span", {}, displayText(m("ui.valueusage_tracking_only", { v0: DISPLAY_SEPARATOR }))) : null
            ]
          })
        ),
        el("td", { class: "group-cell" }, groupsCell),
        el("td", {}, el("span", { class: "native-select key-plan-select" }, select)),
        el("td", {}, renderKeyRoutes(view)),
        el("td", {}, concurrency),
        el("td", {}, usage),
        el(
          "td",
          {},
          deleted
            ? el("span", {
                class: "tag plain",
                text: m("ui.deleted"),
                "data-tip": m("ui.removed_from_cpa_configuration_on_value", { v0: new Date(view.deleted_at).toLocaleString(locale()) })
              })
            : resources.admin.accessControl.value?.enabled &&
                ((!view.group_ids?.length && resources.admin.accessControl.value.deny_ungrouped) ||
                  (view.group_ids?.length &&
                    !(view.group_ids || []).some((id) => {
                      const group = (groups || []).find((entry) => entry.id === id);
                      return group ? groupGrantsAccess(group) : true;
                    })))
              ? el("span", {
                  class: "tag bad",
                  text: m("ui.fork_access_denied"),
                  "data-tip": m("ui.fork_ungrouped_api_key_denied_or_its_groups_have_no_routing_rules_or_upstream_c")
                })
              : view.blocked
                ? el("span", { class: "tag bad", text: m("ui.quota_exhausted") })
                : view.partially_blocked
                  ? el("span", { class: "tag warn", text: m("ui.plan_partially_blocked") })
                  : el("span", {
                      class: "tag " + (view.unlimited ? "plain" : "ok"),
                      text: view.unlimited ? m("ui.unlimited") : m("ui.active")
                    })
        ),
        el(
          "td",
          { class: "small" },
          el("button", {
            class: "link",
            text: m("ui.reset"),
            disabled: deleted || view.unlimited,
            onclick: () =>
              openActionDialog(
                m("ui.reset_subscription_quota"),
                view.windows[0]?.cycle_anchor_at
                  ? m("ui.clear_usage_in_all_windows_and_keep_the_scheduled_reset_times")
                  : m("ui.all_quota_cycles_will_end_new_cycles_start_when_the_next_request_is_admitted"),
                undefined,
                async () => {
                  await mutateAdmin("POST", "/keys/reset", { mode: "all", scopes: [view.scope] });
                  notify(m("ui.subscription_quota_reset"));
                }
              )
          }),
          el("button", {
            class: "link",
            text: m("ui.label"),
            onclick: () =>
              openActionDialog(m("ui.label"), name, keyDirectory.resolve(view).label || "", async (label) => {
                await mutateAdmin("POST", "/keys/label", { scope: view.scope, label });
                notify(m("ui.label_saved"));
              })
          })
        )
      );
    }
  });
}

function renderKeyRoutes(view) {
  const bindings = view.route_bindings;
  const names = bindings.route_ids.map((id) => ({
    iconName: "route",
    text: view.route_names[id] || (Object.hasOwn(view.route_names, id) ? id : m("ui.routing_rule_no_longer_exists"))
  }))
    .concat(routingDimensionChips(bindings, "credential", view.credential_labels))
    .concat(routingDimensionChips(bindings, "model", view.credential_labels));
  const disabled = !!view.deleted_at || adminUIState.keySubmissions.has(view.scope);
  const tooltip = () => [
    el("div", {
      class: "hover-tooltip-heading",
      text: m("ui.full_routing_rulesvaluevalue_items", { v0: DISPLAY_SEPARATOR, v1: names.length })
    }),
    ...names.map((entry) => settingsChipTooltip(entry))
  ];
  return el(
    "div",
    { class: "key-route-cell" },
    el(
      "div",
      { class: "key-route-lines", ...hoverTooltipProps(tooltip, names.length > 3) },
      ...(names.length
        ? names.slice(0, 3).map((entry) => el("div", { class: "key-route-line" }, settingsChipList([entry])))
        : [
            el("div", {
              class: "key-route-line muted",
              text: view.group_ids?.length
                ? m("ui.fork_restricted_by_groups")
                : bindings.configured ? m("ui.fork_no_allowed_credentials_access_denied") : m("ui.fork_no_individual_restrictions")
            })
          ]),
      names.length > 3
        ? el("div", { class: "key-route-more", text: "…", "aria-label": m("ui.value_more", { v0: names.length - 3 }) })
        : null
    ),
    el(
      "div",
      { class: "key-route-actions compact-actions" },
      el("button", {
        type: "button",
        class: "link key-route-clear",
        text: m("ui.clear"),
        disabled: disabled || !names.length,
        "aria-label": m("ui.clear_routing_rules_for_value", { v0: apiKeyIdentity(view).primary }),
        onclick: () =>
          guard(() => {
            closeHoverTooltip();
            return openActionDialog(
              m("ui.clear_routing_rules_for_value_2", { v0: apiKeyIdentity(view).primary }),
              m("ui.remove_all_routing_rule_bindings_and_direct_model_and_credential_allowlists_and_denyl"),
              undefined,
              () =>
                submitKeyChange(view.scope, async () => {
                  await mutateAdmin("PUT", "/keys/routes", { scope: view.scope, bindings: {} });
                  notify(m("ui.api_key_routing_rules_cleared"));
                })
            );
          })
      }),
      el("button", {
        type: "button",
        class: "link key-route-edit",
        text: m("ui.edit"),
        disabled,
        "aria-label": m("ui.edit_routing_rules_for_value", { v0: apiKeyIdentity(view).primary }),
        onclick: () => guard(() => editKeyRoutes(view))
      })
    )
  );
}

async function importCPAMPLabels() {
  const generation = sessionGeneration;
  const result = await api("GET", "/v0/management/api-key-aliases", null);
  if (
    !Array.isArray(result?.items) ||
    result.items.some(
      (item) => !item || typeof item.apiKeyHash !== "string" || !/^[a-f0-9]{64}$/i.test(item.apiKeyHash) || typeof item.alias !== "string"
    )
  )
    throw new UIError(m("ui.invalid_cpamp_label_list"));
  const keys = await fetchConfiguredAPIKeys();
  const scopes = new Map();
  for (const key of keys) {
    const value = key.trim();
    if (value) scopes.set(await sha256Hex(value), await sha256Hex(CALLER_SCOPE_SALT + value));
  }
  if (generation !== sessionGeneration) throw new StaleRequestError();
  let imported = 0;
  let unchanged = 0;
  try {
    for (const item of result.items) {
      if (generation !== sessionGeneration) throw new StaleRequestError();
      const scope = scopes.get(item.apiKeyHash.toLowerCase());
      if (!scope) continue;
      const label = item.alias.trim();
      const key = (resources.admin.keys.value || []).find((key) => key.scope === scope);
      if (key && (keyDirectory.resolve(key).label || "") === label) {
        unchanged++;
        continue;
      }
      await writeAdmin("POST", "/keys/label", { scope, label });
      imported++;
    }
  } catch (err) {
    if (err instanceof AuthError || err instanceof StaleRequestError) throw err;
    throw new UIError(m("ui.imported_value_labels_import_interrupted_value", { v0: imported, v1: err.message || err }));
  } finally { if (imported && generation === sessionGeneration) renderPage(); }
  const skipped = result.items.length - imported - unchanged;
  notify(
    m("ui.imported_value_labelsvaluevalue", {
      v0: imported,
      v1: unchanged ? m("ui.value_unchanged", { v0: unchanged }) : "",
      v2: skipped ? m("ui.value_unmatched_labels_skipped", { v0: skipped }) : ""
    })
  );
}

$("key-filter").addEventListener("input", renderKeys);
$("key-group-filter").addEventListener("change", renderKeys);
$("keys-include-deleted").addEventListener("change", () => {
  saveChoice("admin", "keys-include-deleted");
  renderKeys();
});
$("keys-select-visible").onchange = (event) => {
  for (const view of filteredKeys()) {
    if (view.deleted_at) continue;
    if (event.target.checked) adminUIState.selectedKeys.add(view.scope); else adminUIState.selectedKeys.delete(view.scope);
  }
  renderKeys();
};
$("keys-selection-clear").onclick = () => {
  adminUIState.selectedKeys.clear();
  renderKeys();
};
$("keys-edit-groups").onclick = () => guard(() => editKeyGroups([...adminUIState.selectedKeys]));

$("keys-import-labels").onclick = () =>
  openActionDialog(
    m("ui.import_cpamp_labels"),
    m("ui.import_cpamp_api_key_labels_and_overwrite_existing_labels_for_matching_keys_unmatched"),
    undefined,
    importCPAMPLabels
  );
$("keys-reset-all").onclick = () =>
  openActionDialog(
    m("ui.reset_all_subscription_quotas"),
    m("ui.clear_usage_for_all_non_deleted_api_keys_bound_to_a_plan_shared_cycles_keep_their_res"),
    undefined,
    async () => {
      const result = await mutateAdmin("POST", "/keys/reset", { mode: "global" });
      notify(result.keys ? m("ui.reset_quotas_for_value_api_keys", { v0: result.keys }) : m("ui.no_quotas_to_reset"));
    }
  );

let keyRouteSelection = { scope: "" };

function editKeyRoutes(view) {
  closeHoverTooltip();
  openEditor("route-picker", "route", (data) => {
    const key = data.keys.find((entry) => entry.scope === view.scope);
    if (!key || key.deleted_at) throw new UIError(m("ui.this_api_key_no_longer_exists_refresh_the_list"));
    keyRouteSelection = {
      scope: view.scope,
      routeIDs: new Set(key.route_bindings.route_ids),
      ...routingEditorState(key.route_bindings, "route-picker-enabled-only")
    };
    $("route-picker-search").value = "";
    setText($("route-picker-identity"), apiKeyIdentity(key).text);
    renderKeyRouteList();
  });
}

function routeBindingChoice(selection, id, label, rerender) {
  return el(
    "label",
    { class: "routing-option", "data-routing-binding": id },
    checkboxControl({
      input: el("input", {
        type: "checkbox",
        value: id,
        "data-routing-focus": "route:" + id,
        checked: selection.routeIDs.has(id),
        onchange: (event) => {
          if (event.target.checked) selection.routeIDs.add(id); else selection.routeIDs.delete(id);
          rerender();
        }
      })
    }),
    actionIcon("route"),
    el("span", {}, displayText(label))
  );
}

function renderKeyRouteList() {
  renderRoutingList(
    $("route-picker-list"),
    keyRouteSelection,
    editors.get($("route-picker")).data,
    $("route-picker-search").value,
    renderKeyRouteList
  );
}

function renderRouteRuleList() {
  renderRoutingList(
    $("route-rule-list"),
    routeRuleSelection,
    editors.get($("route-dialog")).data,
    $("route-rule-search").value,
    renderRouteRuleList
  );
}

function routingChoiceGroups(selection, data, term) {
  const groups = [];
  if (selection.routeIDs) {
    const routes = data.routes.map((route) => ({ id: route.id, name: route.name || route.id }));
    for (const id of selection.routeIDs) {
      if (!routes.some((route) => route.id === id)) routes.push({ id, name: m("ui.routing_rule_no_longer_exists_value", { v0: id }) });
    }
    const choices = routes.filter((route) => matchesTerm(route.name, term))
      .map((route) => ({ kind: "route", value: route.id, label: route.name }));
    groups.push(["routes", m("ui.routing_rules"), choices]);
  }
  groups.push(
    ["credentials", m("ui.upstream_credentials"), routeCredentialChoices(selection, data.credentials, term)],
    ["models", m("ui.model"), routeModelChoices(selection, data.models, term)]
  );
  return groups;
}

function routingSelectionCount(selection, kind) {
  if (kind === "routes") return selection.routeIDs.size;
  if (kind === "credentials") return selection.credential.size + selection.provider.size;
  return selection.model.size;
}

function routingChoiceStatus(selection, item) {
  if (item.kind === "route") return selection.routeIDs.has(item.value) ? "allow" : "none";
  return routeChoiceState(selection, item.kind, item.value);
}

function routingItemOrderKey(item) {
  return (item.kind + ":" + (item.kind === "provider" ? item.value.source + ":" + item.value.provider : item.value)).toLowerCase();
}

function filterRoutingChoices(selection, kind, choices) {
  const category = selection.categoryFilters?.[kind] || "";
  const state = selection.stateFilters?.[kind] || "";
  return choices.filter((item) => {
    if (category) {
      const itemCategory =
        kind === "credentials"
          ? credentialProviderLabel(item.kind === "provider" ? item.value : { source: item.source, provider: item.provider })
          : kind === "models" ? planModelFamily(item.value) : "";
      if (itemCategory !== category) return false;
    }
    const current = routingChoiceStatus(selection, item);
    if (state === "selected") return current !== "none";
    if (state === "allow" || state === "deny" || state === "none") return current === state;
    return true;
  });
}

function renderRoutingList(list, selection, data, search, rerender) {
  const term = search.trim().toLowerCase();
  const scrollTop = list.scrollTop;
  const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.routingFocus : null;
  const groups = routingChoiceGroups(selection, data, term);
  selection.orderMemo ||= new Map();
  const pinnedGroups = groups.map(([kind, title, choices]) => [
    kind,
    title,
    pinSelected(selection.orderMemo, kind, choices, routingItemOrderKey, (item) => routingChoiceStatus(selection, item) !== "none")
  ]);
  const kinds = pinnedGroups.map(([kind]) => kind);
  if (!kinds.includes(selection.activeTab)) selection.activeTab = kinds[0] || "credentials";
  const [, activeTitle, allChoices] = pinnedGroups.find(([kind]) => kind === selection.activeTab) || [selection.activeTab, "", []];
  const filteredChoices = filterRoutingChoices(selection, selection.activeTab, allChoices);
  const selectedTotal = routingSelectionCount(selection, selection.activeTab);
  const selectedVisible = allChoices.filter((item) => routingChoiceStatus(selection, item) !== "none").length;
  const hiddenSelected = Math.max(0, selectedTotal - selectedVisible);
  const limit = selection.pageSize?.[selection.activeTab] || 80;
  const visibleChoices = filteredChoices.slice(0, limit);
  const categories =
    selection.activeTab === "credentials"
      ? Array.from(
          new Set(
            allChoices.map((item) =>
              credentialProviderLabel(item.kind === "provider" ? item.value : { source: item.source, provider: item.provider })
            )
              .filter(Boolean)
          )
        )
      : selection.activeTab === "models" ? Array.from(new Set(allChoices.map((item) => planModelFamily(item.value)).filter(Boolean))) : [];
  const categorySelect = categories.length
    ? el(
        "span",
        { class: "native-select" },
        el(
          "select",
          {
            "aria-label": m("ui.fork_filter_value_category", { v0: activeTitle }),
            onchange: (event) => {
              selection.categoryFilters[selection.activeTab] = event.target.value;
              selection.pageSize[selection.activeTab] = 80;
              rerender();
            }
          },
          el("option", { value: "", text: m("ui.fork_all_categories") }),
          ...categories.map((category) =>
            el("option", { value: category, selected: selection.categoryFilters?.[selection.activeTab] === category, text: category })
          )
        )
      )
    : null;
  const stateSelect = el(
    "span",
    { class: "native-select" },
    el(
      "select",
      {
        "aria-label": m("ui.fork_filter_value_selection_state", { v0: activeTitle }),
        onchange: (event) => {
          selection.stateFilters[selection.activeTab] = event.target.value;
          selection.pageSize[selection.activeTab] = 80;
          rerender();
        }
      },
      el("option", { value: "", selected: !selection.stateFilters?.[selection.activeTab], text: m("ui.fork_all_states") }),
      el("option", {
        value: "selected",
        selected: selection.stateFilters?.[selection.activeTab] === "selected",
        text: m("ui.fork_selected")
      }),
      el("option", { value: "allow", selected: selection.stateFilters?.[selection.activeTab] === "allow", text: m("ui.allowlist") }),
      ...(selection.activeTab === "routes"
        ? []
        : [el("option", { value: "deny", selected: selection.stateFilters?.[selection.activeTab] === "deny", text: m("ui.denylist") })]),
      el("option", { value: "none", selected: selection.stateFilters?.[selection.activeTab] === "none", text: m("ui.not_selected") })
    )
  );
  const setFilteredChoices = (state) => {
    for (const item of filteredChoices) {
      if (item.kind === "route") {
        if (state === "none") selection.routeIDs.delete(item.value); else selection.routeIDs.add(item.value);
      } else setRouteChoice(selection, item.kind, item.value, state);
    }
    rerender();
  };
  const rows = visibleChoices.map((item) =>
    item.kind === "route" ? routeBindingChoice(selection, item.value, item.label, rerender) : routeChoiceRow(selection, item, rerender)
  );
  list.replaceChildren(
    el(
      "div",
      { class: "chooser-tabs", role: "tablist" },
      ...pinnedGroups.map(([kind, title, choices]) =>
        el(
          "button",
          {
            type: "button",
            class: "chooser-tab" + (kind === selection.activeTab ? " active" : ""),
            role: "tab",
            "aria-selected": String(kind === selection.activeTab),
            "data-routing-focus": "tab:" + kind,
            onclick: () => {
              selection.activeTab = kind;
              rerender();
            }
          },
          el("span", { text: title }),
          el("span", { class: "chooser-count", text: routingSelectionCount(selection, kind) + "/" + choices.length })
        )
      )
    ),
    el(
      "div",
      { class: "routing-toolbar" },
      categorySelect,
      stateSelect,
      selection.activeTab === "credentials"
        ? compactEnabledToggle(
            selection.enabledOnly,
            (checked) => {
              selection.enabledOnly = checked;
              saveViewPreference("admin", selection.preference, checked);
              rerender();
            },
            m("ui.show_only_enabled_upstream_credentials")
          )
        : null,
      el(
        "div",
        { class: "compact-actions routing-tab-actions" },
        el("button", {
          type: "button",
          class: "link",
          text: selection.activeTab === "routes" ? m("ui.fork_select_filtered") : m("ui.fork_allow_filtered"),
          disabled: !filteredChoices.length,
          onclick: () => setFilteredChoices("allow")
        }),
        selection.activeTab === "routes"
          ? null
          : el("button", {
              type: "button",
              class: "link",
              text: m("ui.fork_deny_filtered"),
              disabled: !filteredChoices.length,
              onclick: () => setFilteredChoices("deny")
            }),
        el("button", {
          type: "button",
          class: "link",
          text: m("ui.fork_clear_filtered"),
          disabled: !filteredChoices.length,
          onclick: () => setFilteredChoices("none")
        })
      ),
      hiddenSelected ? el("span", { class: "small warn-text", text: m("ui.fork_value_selected_hidden", { v0: hiddenSelected }) }) : null
    ),
    el(
      "div",
      { class: "routing-section", "data-routing-section": selection.activeTab },
      ...(rows.length ? rows : [el("div", { class: "routing-empty", text: m("ui.no_value_available", { v0: activeTitle }) })]),
      filteredChoices.length > visibleChoices.length
        ? el(
            "div",
            { class: "routing-more" },
            el("span", {
              class: "small muted",
              text: m("ui.fork_showing_value_of_value", { v0: visibleChoices.length, v1: filteredChoices.length })
            }),
            el("button", {
              type: "button",
              class: "link",
              text: m("ui.fork_show_more_100"),
              onclick: () => {
                selection.pageSize[selection.activeTab] = limit + 100;
                rerender();
              }
            })
          )
        : null
    )
  );
  list.scrollTop = scrollTop;
  if (focusKey)
    [...list.querySelectorAll("[data-routing-focus]")].find((control) => control.dataset.routingFocus === focusKey)
      ?.focus({ preventScroll: true });
}

function compactEnabledToggle(checked, onChange, title) {
  return el(
    "label",
    { class: "toggle-filter compact-toggle", "data-tip": title },
    switchControl({
      input: el("input", {
        type: "checkbox",
        role: "switch",
        "data-routing-focus": "enabled-only",
        checked,
        onchange: (event) => onChange(event.target.checked)
      })
    }),
    el("span", { text: m("ui.enabled_only") })
  );
}

function validateAccessControl(value) {
  if (!value || typeof value.enabled !== "boolean" || typeof value.deny_ungrouped !== "boolean")
    throw new UIError(m("ui.fork_invalid_access_control_response"));
  return value;
}

function renderAccessControl() {
  const resource = resources.admin.accessControl;
  const value = resource.value;
  for (const id of ["access-control-enabled", "access-control-deny-ungrouped", "access-control-save"])
    $(id).disabled = !value || !!adminUIState.accessSaving;
  setText($("access-control-save"), adminUIState.accessSaving ? m("ui.saving") : m("ui.save"));
  const signature = value && JSON.stringify(value);
  if (value && adminUIState.accessControlShown !== signature) {
    $("access-control-enabled").checked = value.enabled;
    $("access-control-deny-ungrouped").checked = value.deny_ungrouped;
    adminUIState.accessControlShown = signature;
  }
  const status = $("access-control-status");
  status.className = resource.error ? "notice err show" : value ? "notice hidden" : "notice show";
  setText(status, resource.error || (value ? "" : m("ui.fork_loading_saved_access_control_settings")));
}

async function saveAccessControl() {
  const owner = adminUIState;
  if (owner.accessSaving || !resources.admin.accessControl.value) return;
  const payload = { enabled: $("access-control-enabled").checked, deny_ungrouped: $("access-control-deny-ungrouped").checked };
  owner.accessSaving = true;
  for (const id of ["access-control-enabled", "access-control-deny-ungrouped", "access-control-save"]) $(id).disabled = true;
  setText($("access-control-save"), m("ui.saving"));
  try {
    const result = await writeAdmin("PUT", "/access-control", payload);
    const saved = validateAccessControl(result.view?.access_control);
    if (saved.enabled !== payload.enabled || saved.deny_ungrouped !== payload.deny_ungrouped)
      throw new UIError(m("ui.fork_saved_settings_differ_from_the_request_refresh_to_confirm"));
    Object.assign(resources.admin.accessControl, { value: saved, error: "" });
    notify(m("ui.fork_access_control_settings_saved"));
    renderPage();
  } catch (error) {
    if (error instanceof AuthError || error instanceof StaleRequestError) return fail(error);
    if (owner === adminUIState) {
      $("access-control-status").className = "notice err show";
      setText($("access-control-status"), m("ui.save_failed_details", { reason: error.message || error }));
    }
  } finally {
    owner.accessSaving = false;
    if (owner === adminUIState) {
      for (const id of ["access-control-enabled", "access-control-deny-ungrouped", "access-control-save"]) $(id).disabled = false;
      setText($("access-control-save"), m("ui.save"));
    }
  }
}

$("access-control-save").onclick = () => guard(saveAccessControl);

function routingDimensionChips(rule, kind, labels) {
  const items = [];
  for (const denied of [false, true]) {
    const prefix = denied ? "denied_" : "";
    const state = denied ? "deny" : "allow";
    if (kind === "model") items.push(...(rule[prefix + "models"] || []).map((text) => ({ text, state, iconName: "astroid" })));
    else {
      items.push(
        ...(rule[prefix + "credential_providers"] || []).map((item) => ({
          text: credentialProviderLabel(item),
          state,
          tag: m("ui.entire_category"),
          iconName: credentialIcon(item)
        }))
      );
      items.push(
        ...(rule[prefix + "credential_ids"] || []).map((ref) => {
          const credential = (resources.admin.credentials.value || []).find((item) => item.ref === ref);
          return {
            text: credential
              ? maskedTailText(credential.provider, credentialName(credential))
              : labels?.[ref]
                ? maskedLabelText(labels[ref])
                : maskedTailText(m("ui.selected_upstream_credentialvaluevalue", { v0: "", v1: "" }), ref.slice(-8)),
            state,
            iconName: credential ? credentialIcon(credential) : "key"
          };
        })
      );
    }
  }
  return items;
}

function groupGrantsAccess(group) {
  return (
    !group.disabled &&
    (!!group.route_ids?.length || Object.values(group.rule || {}).some((values) => Array.isArray(values) && values.length > 0))
  );
}

function groupBindingSummary(group) {
  const rule = group.rule || {};
  const count = (field) => (rule[field] || []).length + (rule["denied_" + field] || []).length;
  const credentials = count("credential_ids") + count("credential_providers");
  const parts = [groupRoutingModeLabel(group)];
  if (group.route_ids?.length) parts.push(m("ui.group_route_count", { count: group.route_ids.length }));
  if (credentials) parts.push(m("ui.group_credential_count", { count: credentials }));
  if (count("models")) parts.push(m("ui.group_model_count", { count: count("models") }));
  if (parts.length === 1) parts.push(m("ui.fork_no_rules_or_credentials_bound_no_access_granted"));
  return [...(group.disabled ? [m("ui.fork_disabled")] : []), ...parts].join(" · ");
}

function groupRoutingModeLabel(group) {
  const mode = ["exclusive", "common"].includes(group.routing_mode) ? group.routing_mode : "ordinary";
  return m("ui.group_mode_" + mode);
}

function validateExclusiveGroupSelection(groups) {
  if (groups.filter((group) => !group.disabled && group.routing_mode === "exclusive").length > 1)
    throw new UIError(m("ui.group_exclusive_conflict"));
}

function groupRoutingFields(group) {
  if (!group.route_ids?.length && !Object.values(group.rule || {}).some((values) => Array.isArray(values) && values.length))
    return [
      settingsEntryField(m("ui.routing_rules"), settingsChipList([], m("ui.fork_no_rules_or_credentials_bound_no_access_granted_37855b")))
    ];
  const routes = (group.route_ids || []).map((id) => ({
    iconName: "route",
    text: resources.admin.routes.value.find((route) => route.id === id)?.name || id
  }));
  return [
    [m("ui.routing_rules"), routes],
    [m("ui.upstream_credentials"), routingDimensionChips(group.rule || {}, "credential", group.credential_labels)],
    [m("backend.model"), routingDimensionChips(group.rule || {}, "model", group.credential_labels)]
  ]
    .filter(([, items]) => items.length)
    .map(([label, items]) => settingsEntryField(label, settingsChipList(items)));
}

function groupAccounts(group) {
  const routes = resources.admin.routes.value || [], credentials = resources.admin.credentials.value || [];
  const rules = [group.rule || {}, ...(group.route_ids || []).map((id) => routes.find((route) => route.id === id)?.rule).filter(Boolean)];
  const matchesProvider = (selectors, item) =>
    (selectors || []).some(
      (selector) => selector.source === item.source && String(selector.provider).toLowerCase() === String(item.provider).toLowerCase()
    );
  const allows = (item) =>
    rules.some((rule) => (rule.credential_ids || []).includes(item.ref) || matchesProvider(rule.credential_providers, item));
  const denies = (item) =>
    rules.some((rule) => (rule.denied_credential_ids || []).includes(item.ref) || matchesProvider(rule.denied_credential_providers, item));
  return credentials.filter((item) => allows(item) && !denies(item)).sort(compareCredentials);
}

function groupAccountRuntime(item, data = resources.admin.accountRuntime.value) {
  const matches = (data?.accounts || []).filter((account) => account.credential_ref === item.ref);
  return matches.length === 1 ? matches[0] : null;
}

async function fetchGroupAccountRuntime() {
  const data = await plugin("GET", "/account-runtime");
  if (Number(data.host_schema || 0) < 6) return data;
  const key = authKey;
  const definitions = CONFIGURED_CREDENTIAL_FIELDS;
  const providers = new Set((data.accounts || []).filter((item) => item.source === "ai-providers").map((item) => item.provider));
  const selected = definitions.filter(([, provider]) => providers.has(provider));
  const results = await Promise.allSettled(
    selected.map(async ([resource, provider, kind, usesHeaders]) => {
      const snapshot = await api("GET", "/v0/management/" + resource, null, { key, raw: true });
      const counters = new Map(), rows = [];
      for (const entry of configuredCredentialEntries(snapshot, resource)) {
        const token = (entry["api-key"] || "").trim(), base = (entry["base-url"] || "").trim();
        if (!token && !base) continue;
        const parts = [token, base, entry["proxy-url"]];
        if (usesHeaders) parts.push(entry.prefix, sortedConfiguredHeaders(entry.headers));
        const identity = await configuredCredentialIdentity(kind, parts, counters);
        const index = typeof entry["auth-index"] === "string" ? entry["auth-index"] : "";
        rows.push({
          credential_ref: identity.ref,
          provider,
          auth_index: index,
          disabled: configuredEntryDisabled(entry),
          selection_unavailable: (entry.weight ?? 1) <= 0,
          status_patch: index ? { name: identity.id, auth_index: index } : null
        });
      }
      return rows;
    })
  );
  const rows = [];
  for (const result of results) {
    if (result.status === "fulfilled") rows.push(...result.value);
    else if (result.reason instanceof AuthError || result.reason instanceof StaleRequestError) throw result.reason;
  }
  for (const account of data.accounts || []) {
    if (!providers.has(account.provider) || account.source !== "ai-providers") continue;
    const matches = rows.filter((row) => row.credential_ref === account.credential_ref && row.provider === account.provider);
    if (matches.length !== 1 || !matches[0].status_patch || rows.filter((row) => row.auth_index === matches[0].auth_index).length !== 1) {
      account.status_patch = null;
      continue;
    }
    Object.assign(account, matches[0]);
  }
  return data;
}

function groupAccountField(group) {
  const items = groupAccounts(group);
  const missing = (group.route_ids || []).some((id) => !(resources.admin.routes.value || []).some((route) => route.id === id));
  const content = el(
    "div",
    { class: "team-group-accounts" },
    missing ? el("div", { class: "auth-quota-error", text: m("ui.team_group_missing_route") }) : null,
    el(
      "div",
      { class: "team-group-account-grid" },
      ...items.map((item) => {
        const runtime = groupAccountRuntime(item), pending = adminUIState.groupAccountSubmissions?.has(item.ref);
        const disabled = runtime ? runtime.disabled : item.disabled;
        const supported = !!runtime?.status_patch?.name && !!runtime?.status_patch?.auth_index;
        return el(
          "div",
          { class: "team-group-account", "data-credential-ref": item.ref },
          el("span", { class: "team-account-name", text: credentialLabel(item), title: credentialLabel(item) }),
          el(
            "label",
            { class: "toggle-filter", title: m(supported ? "ui.group_account_switch_help" : "ui.group_account_switch_unavailable") },
            switchControl({
              input: el("input", {
                type: "checkbox",
                role: "switch",
                checked: !disabled,
                disabled: pending || !supported,
                "aria-label": m("ui.group_account_enable_named", { name: credentialLabel(item) }),
                onchange: (event) => guard(() => setGroupAccountEnabled(item, event.target.checked))
              })
            }),
            el("span", { class: "small", text: m(pending ? "ui.saving" : disabled ? "ui.disabled" : "ui.enabled") })
          ),
          !supported ? el("span", { class: "small muted team-group-account-note", text: m("ui.group_account_switch_unavailable") }) : null,
          runtime?.selection_unavailable
            ? el("span", { class: "small muted team-group-account-note", text: m("ui.group_account_zero_weight") })
            : null
        );
      })
    ),
    !items.length ? el("span", { class: "small muted", text: m("ui.team_group_no_accounts") }) : null,
    group.disabled ? el("span", { class: "small muted", text: m("ui.team_group_disabled_accounts") }) : null
  );
  const field = settingsEntryField(m("ui.team_group_accounts"), content);
  field.classList.add("team-group-field");
  return field;
}

async function setGroupAccountEnabled(item, enabled) {
  const owner = adminUIState;
  owner.groupAccountSubmissions ||= new Set();
  if (owner.groupAccountSubmissions.has(item.ref)) return;
  owner.groupAccountSubmissions.add(item.ref);
  renderGroups();
  let submitted = false;
  try {
    await queueAdminData("configuration", async (current) => {
      const before = await fetchGroupAccountRuntime();
      current();
      const target = groupAccountRuntime(item, before), patch = target?.status_patch;
      if (!patch?.name || !patch.auth_index || patch.auth_index !== target.auth_index)
        throw new UIError(m("ui.group_account_switch_unavailable"));
      submitted = true;
      await api(
        "PATCH",
        "/v0/management/auth-files/status",
        { name: patch.name, auth_index: patch.auth_index, disabled: !enabled },
        { command: true }
      );
      const after = await fetchGroupAccountRuntime();
      current();
      Object.assign(resources.admin.accountRuntime, { value: after, error: "" });
      const verified = groupAccountRuntime(item, after);
      if (!verified || verified.disabled !== !enabled) throw new UIError(m("ui.group_account_switch_unverified"));
    });
    await loadDataGroup(false, "configuration", true);
    notify(m(enabled ? "ui.group_account_enabled" : "ui.group_account_disabled"));
  } catch (error) {
    if (submitted && owner === adminUIState) await loadDataGroup(false, "accountRuntime", true);
    throw error;
  } finally {
    owner.groupAccountSubmissions.delete(item.ref);
    if (owner === adminUIState) renderGroups();
  }
}

function renderGroups() {
  $("group-new").disabled = EDITOR_RESOURCES.group.some((name) => resources.admin[name].value === null);
  if (
    renderDataPending(
      $("groups-body"),
      [resources.admin.groups, resources.admin.keys, resources.admin.routes],
      m("ui.fork_loading"),
      "empty section-loading"
    )
  )
    return;
  renderCollection($("groups-body"), resources.admin.groups.value, {
    attrs: { class: "event-list settings-card-list", role: "list" },
    empty: m("ui.fork_no_groups_create_a_group_to_grant_access_to_multiple_keys"),
    render: (group) =>
      settingsCard(
        group.name || group.id,
        [
          settingsEntryField(m("ui.group_routing_mode"), el("span", { class: "tag plain", text: groupRoutingModeLabel(group) })),
          ...groupRoutingFields(group),
          groupAccountField(group),
          boundKeyField(resources.admin.keys.value.filter((key) => (key.group_ids || []).includes(group.id)))
        ],
        () => editGroup(group),
        () =>
          openActionDialog(
            m("ui.delete_named_group", { name: group.name || group.id }),
            m("ui.fork_this_group_will_be_removed_from_all_keys_remaining_groups_and_the_ungroupe"),
            undefined,
            async () => {
              await mutateAdmin("DELETE", "/groups?id=" + encodeURIComponent(group.id));
              notify(m("ui.fork_group_deleted"));
            }
          ),
        el(
          "label",
          { class: "toggle-filter", title: m("ui.fork_disabling_preserves_rules_and_members_but_stops_granting_access") },
          switchControl({
            input: el("input", {
              type: "checkbox",
              role: "switch",
              checked: !group.disabled,
              "aria-label": m("ui.enable_named_group", { name: group.name || group.id }),
              disabled: adminUIState.groupSubmissions.has(group.id),
              onchange: (event) => guard(() => setGroupEnabled(group, event.target.checked))
            })
          }),
          el("span", { text: group.disabled ? m("backend.disabled") : m("ui.enabled") })
        )
      )
  });
}

async function setGroupEnabled(group, enabled) {
  const owner = adminUIState;
  if (owner.groupSubmissions.has(group.id)) return;
  owner.groupSubmissions.add(group.id);
  renderGroups();
  try {
    await mutateAdmin("PATCH", "/groups", { id: group.id, disabled: !enabled });
    notify(m("ui.group_enabled_changed", { state: enabled ? m("ui.group_enabled_state") : m("ui.group_disabled_state") }));
  } finally {
    owner.groupSubmissions.delete(group.id);
    if (owner === adminUIState) renderGroups();
  }
}

let groupSelection;
let keyGroupSelection;

function groupFilteredKeys() {
  const data = editors.get($("group-dialog")).data;
  const term = $("group-key-search").value.trim().toLowerCase();
  return data.keys.filter((key) => !key.deleted_at || groupSelection.scopes.has(key.scope))
    .filter((key) => keyMatchesGroup(key, $("group-key-filter").value))
    .filter((key) => matchesTerm(apiKeyIdentity(key).text + " " + key.scope, term));
}

function renderGroupKeyList() {
  const data = editors.get($("group-dialog")).data;
  setText($("group-key-count"), m("ui.group_selected_key_count", { count: groupSelection.scopes.size }));
  const keys = groupFilteredKeys();
  $("group-key-list").replaceChildren(
    ...(keys.length
      ? keys.map((key) =>
          el(
            "label",
            {},
            checkboxControl({
              input: el("input", {
                type: "checkbox",
                value: key.scope,
                checked: groupSelection.scopes.has(key.scope),
                onchange: (event) => {
                  if (event.target.checked) groupSelection.scopes.add(key.scope); else groupSelection.scopes.delete(key.scope);
                  setText($("group-key-count"), m("ui.group_selected_key_count", { count: groupSelection.scopes.size }));
                }
              })
            }),
            renderAPIKeyIdentity(key),
            el("span", {
              class: "small muted",
              text:
                (key.group_ids || []).map((id) => data.groups.find((group) => group.id === id)?.name || id).join("、") ||
                m("ui.fork_ungrouped")
            }),
            key.deleted_at ? el("span", { class: "tag plain", text: m("ui.deleted") }) : null
          )
        )
      : [el("div", { class: "empty", text: m("ui.fork_no_matching_api_keys") })])
  );
}

function editGroup(group) {
  openEditor("group-dialog", "group", (data) => {
    const current = group ? data.groups.find((item) => item.id === group.id) : null;
    if (group && !current) throw new UIError(m("ui.fork_this_group_no_longer_exists_refresh_the_list"));
    $("group-id").value = current?.id || "";
    $("group-name").value = current?.name || "";
    $("group-enabled").checked = !current?.disabled;
    for (const input of document.querySelectorAll('input[name="group-routing-mode"]'))
      input.checked = input.value === (current?.routing_mode || "ordinary");
    $("group-dialog").querySelector(".chooser-key-assignment").open = true;
    setText($("group-dialog-title"), current ? m("ui.fork_edit_group") : m("ui.fork_create_group"));
    groupSelection = {
      routeIDs: new Set(current?.route_ids || []),
      ...routingEditorState(current?.rule, "group-credential-enabled-only"),
      scopes: new Set(data.keys.filter((key) => current && (key.group_ids || []).includes(current.id)).map((key) => key.scope))
    };
    $("group-rule-search").value = "";
    renderGroupRuleList();
    $("group-key-search").value = "";
    renderGroupFilter($("group-key-filter"), data.groups);
    $("group-key-filter").value = "";
    renderGroupKeyList();
  });
}

function editKeyGroups(scopes) {
  openEditor("group-picker", "keyGroups", (data) => {
    const keys = scopes.map((scope) => data.keys.find((key) => key.scope === scope && !key.deleted_at));
    if (!keys.length || keys.some((key) => !key)) throw new UIError(m("ui.fork_a_selected_key_no_longer_exists_refresh_the_list"));
    keyGroupSelection = {
      scopes: [...scopes],
      groups: new Set((keys[0].group_ids || []).filter((id) => keys.every((key) => (key.group_ids || []).includes(id))))
    };
    setText(
      $("group-picker-identity"),
      keys.length === 1 ? apiKeyIdentity(keys[0]).text : m("ui.key_common_groups", { count: keys.length })
    );
    $("group-picker-list").replaceChildren(
      ...(data.groups.length
        ? data.groups.map((group) =>
            el(
              "label",
              {},
              checkboxControl({
                input: el("input", {
                  type: "checkbox",
                  checked: keyGroupSelection.groups.has(group.id),
                  value: group.id,
                  onchange: (event) => {
                    if (event.target.checked) keyGroupSelection.groups.add(group.id); else keyGroupSelection.groups.delete(group.id);
                  }
                })
              }),
              el("span", { text: displayLabel(group.name || group.id) }),
              el("span", { class: "small muted", text: groupBindingSummary(group) })
            )
          )
        : [el("div", { class: "empty", text: m("ui.fork_no_groups_create_one_on_the_api_key_groups_tab") })])
    );
  });
}

function renderGroupRuleList() {
  renderRoutingList(
    $("group-rule-list"),
    groupSelection,
    editors.get($("group-dialog")).data,
    $("group-rule-search").value,
    renderGroupRuleList
  );
}

function renderRoutes() {
  if (renderDataPending($("routes-body"), [resources.admin.routes, resources.admin.keys], m("ui.loading"), "empty section-loading")) return;
  $("route-new").disabled = EDITOR_RESOURCES.route.some((name) => resources.admin[name].value === null);
  const routes = resources.admin.routes.value.map((route) => ({
    route,
    boundKeys: resources.admin.keys.value.filter((key) => key.route_bindings.route_ids.includes(route.id))
  }));
  renderCollection($("routes-body"), routes, {
    attrs: { class: "event-list settings-card-list", role: "list" },
    empty: m("ui.no_routing_rules"),
    render: ({ route, boundKeys }) => {
      const fields = [
        ["model", m("ui.model_access"), m("ui.all_models"), "astroid"],
        ["credential", m("ui.credential_access"), m("ui.fork_no_credentials_authorized"), "key"]
      ].map(([kind, label, fallback, iconName]) => {
        const items = routingDimensionChips(route.rule, kind, route.credential_labels);
        if (items.length && !items.some((item) => item.state === "allow")) items.unshift({ text: fallback, iconName });
        return settingsEntryField(label, settingsChipList(items, fallback));
      });
      const name = route.name || route.id;
      return settingsCard(
        name,
        [...fields, boundKeyField(boundKeys)],
        () => editRoute(route),
        () =>
          openActionDialog(
            m("ui.delete_routing_rule_value", { v0: name }),
            boundKeys.length
              ? m("ui.remove_this_rule_from_value_of_these_value_non_deleted_keys_will_have_unrestricted_mo", {
                  v0: bindingSummary(boundKeys),
                  v1: route.fully_unrestricted_keys || 0
                })
              : m("ui.this_action_cannot_be_undone"),
            undefined,
            async () => {
              await mutateAdmin("DELETE", "/routes?id=" + encodeURIComponent(route.id));
              notify(m("ui.routing_rule_deleted"));
            }
          )
      );
    }
  });
}

let routeRuleSelection;

function routeProviderChoices(credentials, selected) {
  const providers = [];
  for (const item of credentials) {
    const existing = providers.find((provider) => sameCredentialProvider(provider, item));
    if (existing) { existing.available ||= !item.disabled && !item.unavailable; } else {
      providers.push({ source: item.source, provider: item.provider, available: !item.disabled && !item.unavailable });
    }
  }
  for (const item of selected) {
    if (providers.some((provider) => sameCredentialProvider(provider, item))) continue;
    providers.push({ ...item, available: false });
  }
  return providers.sort(compareCredentialProviders);
}

const ROUTING_FIELDS = { model: "models", credential: "credential_ids", provider: "credential_providers" };

function routingSelection(rule = {}) {
  const selection = Object.fromEntries(Object.keys(ROUTING_FIELDS).map((kind) => [kind, new Map()]));
  for (const [kind, field] of Object.entries(ROUTING_FIELDS)) {
    for (const [prefix, state] of [["", "allow"], ["denied_", "deny"]]) {
      for (const value of rule[prefix + field] || []) setRouteChoice(selection, kind, value, state);
    }
  }
  return selection;
}

function routingPayload(selection) {
  const rule = {};
  for (const [kind, field] of Object.entries(ROUTING_FIELDS)) {
    rule[field] = [];
    rule["denied_" + field] = [];
    for (const { value, state } of selection[kind].values()) { rule[(state === "deny" ? "denied_" : "") + field].push(value); }
  }
  return rule;
}

function routingEditorState(rule, preference) {
  return {
    ...routingSelection(rule),
    expanded: { routes: true, credentials: true, models: true },
    activeTab: "credentials",
    categoryFilters: { routes: "", credentials: "", models: "" },
    stateFilters: { routes: "", credentials: "", models: "" },
    pageSize: { routes: 80, credentials: 80, models: 80 },
    orderMemo: new Map(),
    enabledOnly: viewPreference("admin", preference, true),
    preference,
    beforeSearch: null
  };
}

function routeChoiceKey(kind, value) { return (kind === "provider" ? value.source + ":" + value.provider : value).toLowerCase(); }

function selectedRouteValues(selection, kind) { return [...selection[kind].values()].map((item) => item.value); }

function routeChoiceState(selection, kind, value) { return selection[kind].get(routeChoiceKey(kind, value))?.state || "none"; }

function setRouteChoice(selection, kind, value, state) {
  const key = routeChoiceKey(kind, value);
  if (state === "none") selection[kind].delete(key);
  else selection[kind].set(key, { value: kind === "provider" ? { source: value.source, provider: value.provider } : value, state });
}

function routeChoiceRow(selection, item, rerender) {
  const { kind, value, label, text, iconName, badge, badgeTone, note } = item;
  const state = routeChoiceState(selection, kind, value);
  const next = { none: "allow", allow: "deny", deny: "none" }[state];
  const names = { none: m("ui.not_selected"), allow: m("ui.allowlist"), deny: m("ui.denylist") };
  const key = kind + ":" + (kind === "provider" ? value.source + ":" + value.provider : value);
  const title = m("ui.valuevalue_value_click_to_switch_to_value", {
    v0: kind === "credential" && iconName ? m("ui.join", { v0: credentialSourceLabel(item.source), v1: DISPLAY_SEPARATOR, v2: "" }) : "",
    v1: label,
    v2: names[state],
    v3: names[next]
  });
  const setChoice = (target) => {
    setRouteChoice(selection, kind, value, state === target ? "none" : target);
    rerender();
  };
  return el(
    "div",
    { class: "routing-option route-choice", "data-state": state, "data-routing-choice": key },
    el(
      "button",
      {
        type: "button",
        class: "route-choice-main",
        "data-routing-focus": key,
        "data-tip": title,
        "aria-label": title,
        onclick: () => {
          setRouteChoice(selection, kind, value, next);
          rerender();
        }
      },
      checkboxControl({ state }),
      iconName ? actionIcon(iconName) : null,
      el("span", { class: "route-choice-name" + (kind === "model" ? " mono" : "") }, text || displayText(label)),
      kind === "provider" ? el("span", { class: "tag warn", text: m("ui.entire_category") }) : null,
      badge ? el("span", { class: "tag " + (badgeTone || "plain"), text: badge }) : null,
      note ? el("span", { class: "route-choice-note", text: note }) : null
    ),
    el(
      "div",
      { class: "route-choice-Quick" },
      el("button", {
        type: "button",
        class: "route-pill" + (state === "allow" ? " active allow" : ""),
        text: m("ui.fork_allow"),
        onclick: () => setChoice("allow")
      }),
      el("button", {
        type: "button",
        class: "route-pill" + (state === "deny" ? " active deny" : ""),
        text: m("ui.fork_deny"),
        onclick: () => setChoice("deny")
      })
    )
  );
}

function routeCredentialChoices(selection, credentials, term) {
  const selectedProviders = selectedRouteValues(selection, "provider");
  const options = routeProviderChoices(credentials, selectedProviders).filter(
    (item) =>
      (!selection.enabledOnly || item.available || routeChoiceState(selection, "provider", item) !== "none") &&
      matchesTerm(m("ui.value_entire_category", { v0: credentialProviderLabel(item) }), term)
  )
    .map((item) => ({
      kind: "provider",
      value: item,
      label: credentialProviderLabel(item),
      iconName: credentialIcon(item),
      badge: item.available ? "" : m("ui.none_available")
    }));
  for (const item of credentials.filter(
    (item) =>
      (!selection.enabledOnly || !item.disabled || routeChoiceState(selection, "credential", item.ref) !== "none") &&
      matchesTerm(credentialLabel(item), term)
  )
    .sort(compareCredentials)) {
    const statusBadge = item.disabled
      ? [m("ui.disabled"), "plain"]
      : item.unavailable
        ? [item.status === "error" ? m("ui.error") : m("ui.unavailable"), item.status === "error" ? "bad" : "warn"]
        : item.status === "pending" ? [m("ui.fork_pending"), "plain"] : ["", "plain"];
    options.push({
      kind: "credential",
      value: item.ref,
      label: credentialLabel(item),
      text: maskedTailText(item.provider, credentialName(item)),
      source: item.source,
      provider: item.provider,
      iconName: credentialIcon(item),
      badge: statusBadge[0],
      badgeTone: statusBadge[1],
      note: item.status_message || ""
    });
  }
  for (const ref of selectedRouteValues(selection, "credential")) {
    if (!credentials.some((item) => item.ref === ref) && matchesTerm(ref, term))
      options.push({
        kind: "credential",
        value: ref,
        label: m("ui.credential_no_longer_exists"),
        iconName: "key",
        badge: m("ui.none_available")
      });
  }
  return options;
}

function routeModelChoices(selection, available, term) {
  // Keep retired selections so a temporary provider outage cannot rewrite access.
  const known = new Set(available.map((model) => model.toLowerCase()));
  const retired = selectedRouteValues(selection, "model").filter((model) => !known.has(model.toLowerCase())).sort(compareModelId);
  return available.concat(retired).filter((model) => matchesTerm(model, term)).map((model) => ({
    kind: "model",
    value: model,
    label: model,
    iconName: "astroid",
    note: retired.includes(model) ? m("ui.not_in_the_cpa_model_list") : ""
  }));
}

let routeKeyScopes = new Set();

function renderRouteKeyList() {
  const editor = editors.get($("route-dialog"));
  if (!editor) return;
  const routeID = $("route-id").value;
  const term = ($("route-key-search")?.value || "").trim().toLowerCase();
  const list = $("route-key-list");
  routeRuleSelection.keyOrderMemo ||= new Map();
  const orderedKeys = pinSelected(
    routeRuleSelection.keyOrderMemo,
    "keys",
    editor.data.keys,
    (key) => key.scope,
    (key) => routeKeyScopes.has(key.scope)
  );
  const keys = orderedKeys
    .filter((key) => !key.deleted_at || (routeID && key.route_bindings.route_ids.includes(routeID)) || routeKeyScopes.has(key.scope))
    .filter((key) =>
      matchesTerm([apiKeyIdentity(key).text, ...(key.group_names || []), key.plan_name, key.scope].filter(Boolean).join(" "), term)
    );
  if (!keys.length) {
    list.replaceChildren(el("div", { class: "empty", text: m("ui.no_api_keys") }));
    return;
  }
  list.replaceChildren(
    ...keys.map((key) => {
      const checked = routeKeyScopes.has(key.scope);
      return el(
        "label",
        {},
        checkboxControl({
          input: el("input", {
            type: "checkbox",
            value: key.scope,
            checked,
            onchange: (event) => { if (event.target.checked) routeKeyScopes.add(key.scope); else routeKeyScopes.delete(key.scope); }
          })
        }),
        renderAPIKeyIdentity(key),
        key.deleted_at ? el("span", { class: "tag plain", text: m("ui.deleted"), "data-tip": m("ui.uncheck_to_remove_the_binding") }) : null
      );
    })
  );
}

function editRoute(route) {
  const id = route?.id;
  openEditor("route-dialog", "route", (data) => {
    const current = id ? data.routes.find((entry) => entry.id === id) : null;
    if (id && !current) throw new UIError(m("ui.this_routing_rule_no_longer_exists_close_the_dialog_and_refresh_the_list"));
    setText($("route-dialog-title"), current ? m("ui.edit_rule_value", { v0: current.name || id }) : m("ui.create_rule"));
    $("route-id").value = id || "";
    setText($("route-save"), current ? m("ui.save") : m("ui.create"));
    $("route-name").value = current?.name || "";
    $("route-rule-search").value = "";
    if ($("route-key-search")) $("route-key-search").value = "";
    routeRuleSelection = routingEditorState(current?.rule, "route-credential-enabled-only");
    const initialScopes = data.keys.filter((key) => id && key.route_bindings.route_ids.includes(id)).map((key) => key.scope);
    routeKeyScopes = new Set(initialScopes);
    renderRouteRuleList();
    renderRouteKeyList();
    return { route: structuredClone(current), scopes: initialScopes };
  });
}

$("route-picker-search").addEventListener("input", renderKeyRouteList);
$("route-key-search")?.addEventListener("input", renderRouteKeyList);
$("route-picker-all").onclick = () => setVisibleRouteChoices("route-picker", keyRouteSelection, "allow", renderKeyRouteList);
$("route-picker-deny-all").onclick = () => setVisibleRouteChoices("route-picker", keyRouteSelection, "deny", renderKeyRouteList);
$("route-picker-save").onclick = () =>
  submitEditor("route-picker", async () => {
    await mutateAdmin("PUT", "/keys/routes", {
      scope: keyRouteSelection.scope,
      bindings: { route_ids: [...keyRouteSelection.routeIDs], ...routingPayload(keyRouteSelection) }
    });
    notify(m("ui.api_key_routing_rules_saved"));
  });
$("route-picker-clear").onclick = () => {
  keyRouteSelection.routeIDs.clear();
  Object.assign(keyRouteSelection, routingSelection());
  keyRouteSelection.orderMemo?.clear();
  renderKeyRouteList();
};
$("route-picker").addEventListener("close", () => { if (!$("route-picker").open) keyRouteSelection = { scope: "" }; });
$("route-rule-search").addEventListener("input", renderRouteRuleList);
function setVisibleRouteChoices(id, selection, state, rerender) {
  const dialog = $(id);
  const data = editors.get(dialog).data;
  const term = dialog.querySelector('input[type="search"]').value.trim().toLowerCase();
  const groups = routingChoiceGroups(selection, data, term);
  const active = groups.find(([kind]) => kind === selection.activeTab) || groups[0];
  if (!active) return;
  const [kind, , choices] = active;
  for (const item of filterRoutingChoices(selection, kind, choices)) {
    if (item.kind === "route") {
      if (state === "none") selection.routeIDs.delete(item.value); else selection.routeIDs.add(item.value);
    } else setRouteChoice(selection, item.kind, item.value, state);
  }
  rerender();
}
$("route-rule-all").onclick = () => setVisibleRouteChoices("route-dialog", routeRuleSelection, "allow", renderRouteRuleList);
$("route-rule-deny-all").onclick = () => setVisibleRouteChoices("route-dialog", routeRuleSelection, "deny", renderRouteRuleList);
$("route-rule-none").onclick = () => {
  Object.assign(routeRuleSelection, routingSelection());
  routeRuleSelection.orderMemo?.clear();
  renderRouteRuleList();
};
$("route-new").onclick = () => editRoute();
$("route-save").onclick = () =>
  submitEditor("route-dialog", async (editor) => {
    const name = $("route-name").value.trim();
    if (!name) throw new UIError(m("ui.enter_a_rule_name"));
    const id = $("route-id").value;
    const rule = routingPayload(routeRuleSelection);
    const scopes = [...routeKeyScopes];
    const data = { name, rule, scopes };
    if (id) {
      const route = editor.initial.route;
      if (
        route?.bound_key_count &&
        !(await openActionDialog(
          m("ui.save_routing_rule"),
          m("ui.update_the_selected_keys_bindings_and_rules_value", {
            v0: route.deleted_key_count ? m("ui.deleted_keys_will_also_retain_or_lose_bindings_according_to_this_selection_retained_b") : ""
          })
        ))
      )
        return false;
      if (!editorCurrent(editor)) return false;
      if (sameScopes(scopes, editor.initial.scopes)) delete data.scopes;
      if (name === route.name) delete data.name;
      if (JSON.stringify(rule) === JSON.stringify(routingPayload(routingSelection(route.rule)))) delete data.rule;
      if (!Object.keys(data).length) return;
      await mutateAdmin("PATCH", "/routes", { id, ...data });
    } else await mutateAdmin("POST", "/routes", data);
    notify(id ? m("ui.routing_rule_saved") : m("ui.routing_rule_created"));
  });

$("group-new").onclick = () => editGroup();
$("group-rule-search").addEventListener("input", renderGroupRuleList);
$("group-rule-all").onclick = () => setVisibleRouteChoices("group-dialog", groupSelection, "allow", renderGroupRuleList);
$("group-rule-deny-all").onclick = () => setVisibleRouteChoices("group-dialog", groupSelection, "deny", renderGroupRuleList);
$("group-rule-clear").onclick = () => setVisibleRouteChoices("group-dialog", groupSelection, "none", renderGroupRuleList);
$("group-dialog").addEventListener("close", () => { if (!$("group-dialog").open) groupSelection = null; });
$("group-key-search").addEventListener("input", renderGroupKeyList);
$("group-key-filter").addEventListener("change", renderGroupKeyList);
$("group-key-all").onclick = () => {
  for (const key of groupFilteredKeys()) groupSelection.scopes.add(key.scope);
  renderGroupKeyList();
};
$("group-key-none").onclick = () => {
  for (const key of groupFilteredKeys()) groupSelection.scopes.delete(key.scope);
  renderGroupKeyList();
};
$("group-save").onclick = () =>
  submitEditor("group-dialog", async () => {
    const name = $("group-name").value.trim();
    if (!name) throw new UIError(m("ui.fork_enter_a_group_name"));
    const id = $("group-id").value;
    const data = {
      name,
      disabled: !$("group-enabled").checked,
      routing_mode: document.querySelector('input[name="group-routing-mode"]:checked')?.value || "ordinary",
      route_ids: [...groupSelection.routeIDs],
      rule: routingPayload(groupSelection),
      scopes: [...groupSelection.scopes]
    };
    if (!data.disabled && data.routing_mode === "exclusive") {
      const editor = editors.get($("group-dialog")).data;
      for (const key of editor.keys.filter((item) => groupSelection.scopes.has(item.scope)))
        validateExclusiveGroupSelection([
          ...editor.groups.filter((item) => item.id !== id && (key.group_ids || []).includes(item.id)),
          data
        ]);
    }
    await mutateAdmin(id ? "PATCH" : "POST", "/groups", id ? { id, ...data } : data);
    notify(m("ui.fork_group_saved"));
  });
$("group-picker-save").onclick = () =>
  submitEditor("group-picker", async () => {
    validateExclusiveGroupSelection(editors.get($("group-picker")).data.groups.filter((group) => keyGroupSelection.groups.has(group.id)));
    await mutateAdmin("PUT", "/keys/groups", { scopes: keyGroupSelection.scopes, group_ids: [...keyGroupSelection.groups] });
    notify(m("ui.fork_api_key_groups_saved"));
  });

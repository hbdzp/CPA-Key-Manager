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

function validateAccessControl() {
  const enabled = $("access-control-enabled").checked;
  const denyUngrouped = $("access-control-deny-ungrouped").checked;
  if (!enabled) {
    $("access-control-deny-ungrouped").checked = false;
    $("access-control-deny-ungrouped").disabled = true;
  } else { $("access-control-deny-ungrouped").disabled = false; }
  const current = resources.admin.accessControl.value || { enabled: false, deny_ungrouped: false };
  const dirty = Boolean(current.enabled) !== enabled || (enabled && Boolean(current.deny_ungrouped) !== denyUngrouped);
  $("access-control-save").disabled = !dirty;
}

function renderAccessControl() {
  if (
    renderDataPending(
      $("access-control-status"),
      [resources.admin.accessControl, resources.admin.keys, resources.admin.groups],
      m("ui.loading")
    )
  ) {
    $("access-control-save").disabled = true;
    return;
  }
  const settings = resources.admin.accessControl.value || { enabled: false, deny_ungrouped: false };
  $("access-control-enabled").checked = Boolean(settings.enabled);
  $("access-control-deny-ungrouped").checked = Boolean(settings.enabled && settings.deny_ungrouped);
  validateAccessControl();
  const keys = (resources.admin.keys.value || []).filter((key) => !key.deleted_at);
  const ungrouped = keys.filter((key) => !key.group_ids?.length).length;
  const groups = resources.admin.groups.value || [];
  const authorizedGroups = groups.filter(groupGrantsAccess).length;
  $("access-control-status").replaceChildren(
    el("span", {
      class: "tag " + (settings.enabled ? "warn" : "plain"),
      text: settings.enabled ? m("ui.fork_access_control_enabled") : m("ui.fork_access_control_disabled")
    }),
    el("span", {
      class: "tag " + (settings.enabled && settings.deny_ungrouped ? "bad" : "plain"),
      text:
        settings.enabled && settings.deny_ungrouped
          ? m("ui.fork_ungrouped_keys_denied_value", { v0: int(ungrouped) })
          : m("ui.fork_ungrouped_keys_allowed_value", { v0: int(ungrouped) })
    }),
    el("span", {
      class: "tag plain",
      text: m("ui.fork_authorized_groups_value_value", { v0: int(authorizedGroups), v1: int(groups.length) })
    })
  );
}

async function saveAccessControl() {
  const button = $("access-control-save");
  button.disabled = true;
  try {
    const enabled = $("access-control-enabled").checked;
    const denyUngrouped = enabled && $("access-control-deny-ungrouped").checked;
    await mutateAdmin("PUT", "/access-control", { enabled, deny_ungrouped: denyUngrouped });
    notify(m("ui.fork_access_control_updated"));
  } finally { validateAccessControl(); }
}

$("access-control-enabled").addEventListener("change", validateAccessControl);
$("access-control-deny-ungrouped").addEventListener("change", validateAccessControl);
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
  if (group?.enabled === false) return false;
  const bindings = group?.route_bindings || {};
  return Boolean(
    bindings.route_ids?.length || bindings.models?.length || bindings.denied_models?.length || bindings.credential_ids?.length ||
      bindings.denied_credential_ids?.length ||
      bindings.credential_providers?.length ||
      bindings.denied_credential_providers?.length
  );
}

function groupBindingSummary(groups) { return m("ui.fork_value_groups", { v0: groups.length }); }

function groupRoutingModeLabel(mode) {
  return mode === "exclusive" ? m("ui.fork_exclusive_pool") : mode === "common" ? m("ui.fork_common_pool") : m("ui.fork_standard_pool");
}

function validateExclusiveGroupSelection(groupID, mode, bindings, groups = resources.admin.groups.value || []) {
  const allowedIDs = new Set(bindings.credential_ids || []);
  const allowedProviders = bindings.credential_providers || [];
  if (mode === "exclusive") {
    if (bindings.route_ids?.length)
      throw new UIError(m("ui.fork_exclusive_groups_must_bind_upstream_credentials_directly_routing_rule_bindings_a"));
    if (!allowedIDs.size && !allowedProviders.length)
      throw new UIError(m("ui.fork_exclusive_groups_must_select_at_least_one_upstream_credential"));
  }
  const touches = (otherBindings) => {
    for (const ref of otherBindings.credential_ids || []) if (allowedIDs.has(ref)) return ref;
    for (const provider of otherBindings.credential_providers || []) {
      if (allowedProviders.some((item) => sameCredentialProvider(item, provider))) return credentialProviderLabel(provider);
    }
    const credentials = resources.admin.credentials.value || [];
    for (const item of credentials) {
      const inCurrent = allowedIDs.has(item.ref) || allowedProviders.some((provider) => sameCredentialProvider(provider, item));
      const inOther =
        (otherBindings.credential_ids || []).includes(item.ref) ||
        (otherBindings.credential_providers || []).some((provider) => sameCredentialProvider(provider, item));
      if (inCurrent && inOther) return credentialLabel(item);
    }
    return "";
  };
  for (const other of groups) {
    if (!other || other.id === groupID) continue;
    const otherMode = other.routing_mode || "ordinary";
    if (mode !== "exclusive" && otherMode !== "exclusive") continue;
    const conflict = touches(other.route_bindings || {});
    if (conflict) {
      throw new UIError(
        mode === "exclusive"
          ? m("ui.fork_exclusive_credential_conflict_with_group_value_value", { v0: other.name || other.id, v1: conflict })
          : m("ui.fork_credential_belongs_to_exclusive_group_value_value", { v0: other.name || other.id, v1: conflict })
      );
    }
  }
}

function groupRoutingFields(group) {
  const bindings = group.route_bindings || {};
  const enabled = group.enabled !== false;
  const routes = (bindings.route_ids || []).map((id) => ({
    iconName: "route",
    text: group.route_names?.[id] || (Object.hasOwn(group.route_names || {}, id) ? id : m("ui.routing_rule_no_longer_exists"))
  }));
  const models = routingDimensionChips(bindings, "model", group.credential_labels);
  const credentials = routingDimensionChips(bindings, "credential", group.credential_labels);
  const authorized = groupGrantsAccess(group);
  const mode = group.routing_mode || "ordinary";
  return [
    settingsEntryField(
      m("ui.status"),
      el(
        "div",
        { class: "settings-chip-list" },
        el("span", {
          class: "tag " + (!enabled ? "plain" : authorized ? "ok" : "warn"),
          text: !enabled ? m("ui.disabled") : authorized ? m("ui.active") : m("ui.fork_no_upstream_access_configured")
        }),
        el("span", {
          class: "tag " + (mode === "exclusive" ? "warn" : mode === "common" ? "ok" : "plain"),
          text: groupRoutingModeLabel(mode)
        })
      )
    ),
    group.description ? settingsEntryField(m("ui.description"), el("span", { text: displayLabel(group.description) })) : null,
    settingsEntryField(m("ui.routing_rules"), settingsChipList(routes, "—")),
    settingsEntryField(
      m("ui.model_access"),
      settingsChipList(models, routes.length ? m("ui.fork_from_routing_rules") : m("ui.all_models"))
    ),
    settingsEntryField(
      m("ui.credential_access"),
      settingsChipList(credentials, routes.length ? m("ui.fork_from_routing_rules") : m("ui.fork_no_credentials_authorized"))
    ),
    groupAccountField(group)
  ].filter(Boolean);
}

let groupAccountRuntime = { items: new Map(), loading: false };

async function fetchGroupAccountRuntime() {
  if (groupAccountRuntime.loading) return;
  groupAccountRuntime.loading = true;
  try {
    const result = await plugin("GET", "/accounts/runtime").catch(() => null);
    if (Array.isArray(result?.items)) {
      groupAccountRuntime.items = new Map(result.items.map((item) => [item.ref, item]));
      if (currentRole === "admin" && activeTab(false) === "groups") renderGroups();
    }
  } finally { groupAccountRuntime.loading = false; }
}

function groupAccounts(group) {
  const credentials = resources.admin.credentials.value || [];
  const routes = resources.admin.routes.value || [];
  const rules = [
    group.route_bindings || {},
    ...(group.route_bindings?.route_ids || []).map((id) => routes.find((route) => route.id === id)?.rule).filter(Boolean)
  ];
  const matched = new Map();
  for (const rule of rules) {
    for (const ref of rule.credential_ids || []) {
      const found = credentials.find((item) => item.ref === ref);
      const runtime = groupAccountRuntime.items.get(ref);
      matched.set(
        ref,
        found
          ? { ...found, disabled: runtime ? Boolean(runtime.disabled) : Boolean(found.disabled) }
          : {
              ref,
              source: runtime?.source || (ref.startsWith("auth:") ? "auth" : "config"),
              provider: runtime?.provider || "",
              name: runtime?.name || group.credential_labels?.[ref] || ref.slice(-8),
              disabled: Boolean(runtime?.disabled),
              unavailable: runtime ? Boolean(runtime.unavailable) : true,
              status: runtime?.status || "missing",
              status_message: runtime?.status_message || ""
            }
      );
    }
    for (const provider of rule.credential_providers || []) {
      for (const item of credentials) {
        if (sameCredentialProvider(provider, item)) {
          const runtime = groupAccountRuntime.items.get(item.ref);
          matched.set(item.ref, { ...item, disabled: runtime ? Boolean(runtime.disabled) : Boolean(item.disabled) });
        }
      }
    }
  }
  for (const rule of rules) {
    for (const ref of rule.denied_credential_ids || []) matched.delete(ref);
    for (const provider of rule.denied_credential_providers || []) {
      for (const [ref, item] of matched.entries()) { if (sameCredentialProvider(provider, item)) matched.delete(ref); }
    }
  }
  return [...matched.values()].sort(compareCredentials);
}

function groupAccountField(group) {
  const accounts = groupAccounts(group);
  if (!accounts.length && !groupAccountRuntime.loading) fetchGroupAccountRuntime();
  const chips = accounts.map((item) => {
    const busy = adminUIState.groupSubmissions.has("account:" + item.ref);
    const runtime = groupAccountRuntime.items.get(item.ref);
    const statusText = item.disabled
      ? m("ui.disabled")
      : item.unavailable
        ? m("ui.unavailable")
        : runtime?.status === "error" ? m("ui.error") : runtime?.status === "pending" ? m("ui.fork_pending") : m("ui.active");
    const statusTone = item.disabled ? "plain" : item.unavailable || runtime?.status === "error" ? "bad" : "ok";
    const statusTitle = runtime?.status_message || item.status_message || "";
    const statusButton = el("button", {
      type: "button",
      class: "link small group-account-toggle",
      text: item.disabled ? m("ui.enable") : m("ui.disable"),
      disabled: busy,
      onclick: () => guard(() => setGroupAccountEnabled(item, item.disabled))
    });
    return {
      text: maskedTailText(item.provider, credentialName(item)),
      iconName: credentialIcon(item),
      status: statusText,
      statusTone,
      hint: statusTitle,
      control: statusButton
    };
  });
  return settingsEntryField(
    m("ui.fork_group_accounts"),
    el("div", { class: "team-group-accounts" }, settingsChipList(chips, m("ui.fork_no_bound_accounts_matched")))
  );
}

async function setGroupAccountEnabled(item, enabled) {
  const key = "account:" + item.ref;
  if (adminUIState.groupSubmissions.has(key)) return;
  adminUIState.groupSubmissions.add(key);
  renderGroups();
  try {
    await plugin("POST", "/accounts/status", { ref: item.ref, disabled: !enabled });
    const existing = groupAccountRuntime.items.get(item.ref) || {};
    groupAccountRuntime.items.set(item.ref, { ...existing, ref: item.ref, disabled: !enabled });
    await Promise.all([
      loadDataGroup(false, "configuration", true),
      loadDataGroup(false, "accountRuntime", true),
      readAuthFiles(false, true).catch(() => {})
    ]);
    notify(enabled ? m("ui.fork_account_enabled") : m("ui.fork_account_disabled"));
  } finally {
    adminUIState.groupSubmissions.delete(key);
    renderGroups();
  }
}

function renderGroups() {
  renderAccessControl();
  if (renderDataPending($("groups-body"), [resources.admin.groups, resources.admin.keys], m("ui.loading"), "empty section-loading")) return;
  if (!groupAccountRuntime.items.size && !groupAccountRuntime.loading) fetchGroupAccountRuntime();
  $("group-new").disabled = EDITOR_RESOURCES.group.some((name) => resources.admin[name].value === null);
  const groups = resources.admin.groups.value.map((group) => ({
    group,
    boundKeys: resources.admin.keys.value.filter((key) => (key.group_ids || []).includes(group.id))
  }));
  renderCollection($("groups-body"), groups, {
    attrs: { class: "event-list settings-card-list", role: "list" },
    empty: m("ui.fork_no_groups"),
    render: ({ group, boundKeys }) => {
      const name = group.name || group.id;
      const enabled = group.enabled !== false;
      const busy = adminUIState.groupSubmissions.has(group.id);
      const toggle = el(
        "label",
        { class: "toggle-filter compact-toggle", "data-tip": m("ui.fork_enable_or_disable_this_group") },
        switchControl({
          input: el("input", {
            type: "checkbox",
            role: "switch",
            checked: enabled,
            disabled: busy,
            "aria-label": m("ui.fork_enable_group_value", { v0: name }),
            onchange: (event) => guard(() => setGroupEnabled(group, event.target.checked))
          })
        }),
        el("span", { text: enabled ? m("ui.enabled") : m("ui.disabled") })
      );
      return settingsCard(
        name,
        [...groupRoutingFields(group), boundKeyField(boundKeys)],
        () => editGroup(group),
        () =>
          openActionDialog(
            m("ui.fork_delete_group_value", { v0: name }),
            boundKeys.length
              ? m("ui.fork_remove_this_group_from_value_value", {
                  v0: bindingSummary(boundKeys),
                  v1:
                    resources.admin.accessControl.value?.enabled && resources.admin.accessControl.value?.deny_ungrouped
                      ? m("ui.fork_keys_left_without_a_group_will_be_denied_until_assigned_to_another_group")
                      : ""
                })
              : m("ui.this_action_cannot_be_undone"),
            undefined,
            async () => {
              await mutateAdmin("DELETE", "/groups?id=" + encodeURIComponent(group.id));
              notify(m("ui.fork_group_deleted"));
            }
          ),
        toggle
      );
    }
  });
}

async function setGroupEnabled(group, enabled) {
  const owner = adminUIState;
  if (owner.groupSubmissions.has(group.id)) return;
  owner.groupSubmissions.add(group.id);
  renderGroups();
  try {
    await mutateAdmin("PATCH", "/groups", { id: group.id, enabled });
    notify(enabled ? m("ui.fork_group_enabled") : m("ui.fork_group_disabled"));
  } finally {
    owner.groupSubmissions.delete(group.id);
    if (owner === adminUIState) renderGroups();
  }
}

let groupSelection;
let keyGroupSelection = { scopes: [] };

function groupFilteredKeys(keys, groupID, selectedScopes) {
  const term = $("group-key-search").value.trim().toLowerCase();
  const groupFilter = $("group-key-filter").value;
  return keys.filter((key) => !key.deleted_at || (groupID && (key.group_ids || []).includes(groupID)) || selectedScopes.has(key.scope))
    .filter((key) => {
      if (groupFilter === "__current__") return selectedScopes.has(key.scope);
      return keyMatchesGroup(key, groupFilter);
    })
    .filter((key) =>
      matchesTerm([apiKeyIdentity(key).text, ...(key.group_names || []), key.plan_name, key.scope].filter(Boolean).join(" "), term)
    );
}

function renderGroupKeyList() {
  const editor = editors.get($("group-dialog"));
  if (!editor) return;
  const list = $("group-key-list");
  const groupID = $("group-id").value;
  const selectedScopes = groupSelection.keyScopes;
  groupSelection.keyOrderMemo ||= new Map();
  const orderedKeys = pinSelected(
    groupSelection.keyOrderMemo,
    "keys",
    editor.data.keys,
    (key) => key.scope,
    (key) => selectedScopes.has(key.scope)
  );
  const keys = groupFilteredKeys(orderedKeys, groupID, selectedScopes);
  if (!keys.length) {
    list.replaceChildren(el("div", { class: "empty", text: m("ui.fork_no_matching_api_keys") }));
    return;
  }
  list.replaceChildren(
    ...keys.map((key) => {
      const checked = selectedScopes.has(key.scope);
      const otherGroups = (key.group_names || []).filter((_, index) => (key.group_ids || [])[index] !== groupID);
      return el(
        "label",
        {},
        checkboxControl({
          input: el("input", {
            type: "checkbox",
            value: key.scope,
            checked,
            onchange: (event) => { if (event.target.checked) selectedScopes.add(key.scope); else selectedScopes.delete(key.scope); }
          })
        }),
        renderAPIKeyIdentity(key),
        otherGroups.length ? el("span", { class: "muted small", text: otherGroups.join(", ") }) : null,
        key.deleted_at ? el("span", { class: "tag plain", text: m("ui.deleted"), "data-tip": m("ui.uncheck_to_remove_the_binding") }) : null
      );
    })
  );
}

function editGroup(group) {
  const id = group?.id;
  openEditor("group-dialog", "group", (data) => {
    const current = id ? data.groups.find((entry) => entry.id === id) : null;
    if (id && !current) throw new UIError(m("ui.fork_this_group_no_longer_exists_close_the_dialog_and_refresh_the_list"));
    setText($("group-dialog-title"), current ? m("ui.fork_edit_group_value", { v0: current.name || id }) : m("ui.fork_create_group"));
    $("group-id").value = id || "";
    setText($("group-save"), current ? m("ui.save") : m("ui.create"));
    $("group-name").value = current?.name || "";
    $("group-description").value = current?.description || "";
    $("group-enabled").checked = current ? current.enabled !== false : true;
    $("group-routing-mode").value = current?.routing_mode || "ordinary";
    $("group-rule-search").value = "";
    $("group-key-search").value = "";
    const filter = $("group-key-filter");
    filter.replaceChildren(
      el("option", { value: "", text: m("ui.fork_all_keys") }),
      el("option", { value: "__current__", text: m("ui.fork_selected_in_this_group") }),
      el("option", { value: "__ungrouped__", text: m("ui.fork_ungrouped") }),
      ...data.groups.map((item) => el("option", { value: item.id, text: displayLabel(item.name || item.id) }))
    );
    filter.value = "";
    const initialScopes = data.keys.filter((key) => id && (key.group_ids || []).includes(id)).map((key) => key.scope);
    groupSelection = {
      routeIDs: new Set(current?.route_bindings?.route_ids || []),
      ...routingEditorState(current?.route_bindings, "group-credential-enabled-only"),
      keyScopes: new Set(initialScopes)
    };
    renderGroupRuleList();
    renderGroupKeyList();
    return { group: structuredClone(current), scopes: initialScopes };
  });
}

function editKeyGroups(scopes) {
  closeHoverTooltip();
  const cleanScopes = Array.from(new Set((scopes || []).filter(Boolean)));
  if (!cleanScopes.length) return;
  openEditor("group-picker", "keyGroups", (data) => {
    const keys = cleanScopes.map((scope) => data.keys.find((entry) => entry.scope === scope)).filter((entry) => entry && !entry.deleted_at);
    if (!keys.length) throw new UIError(m("ui.this_api_key_no_longer_exists_refresh_the_list"));
    keyGroupSelection = { scopes: keys.map((entry) => entry.scope) };
    setText(
      $("group-picker-identity"),
      keys.length === 1 ? apiKeyIdentity(keys[0]).text : m("ui.fork_value_api_keys_selected", { v0: keys.length })
    );
    const list = $("group-picker-list");
    if (!data.groups.length) {
      list.replaceChildren(el("div", { class: "empty", text: m("ui.fork_no_groups_created_yet") }));
      return;
    }
    const orderedGroups = pinSelected(
      new Map(),
      "groups",
      data.groups,
      (group) => group.id,
      (group) => keys.some((key) => (key.group_ids || []).includes(group.id))
    );
    list.replaceChildren(
      ...orderedGroups.map((group) => {
        const count = keys.filter((key) => (key.group_ids || []).includes(group.id)).length;
        const checked = count === keys.length;
        const indeterminate = count > 0 && count < keys.length;
        const input = el("input", {
          type: "checkbox",
          value: group.id,
          checked,
          onchange: () => {
            input.indeterminate = false;
            delete input.dataset.mixed;
          }
        });
        if (indeterminate) {
          input.indeterminate = true;
          input.dataset.mixed = "true";
        }
        return el(
          "label",
          {},
          checkboxControl({ input }),
          el("span", {}, displayText(group.name || group.id)),
          group.enabled === false ? el("span", { class: "tag plain", text: m("ui.disabled") }) : null,
          !groupGrantsAccess(group) ? el("span", { class: "tag warn", text: m("ui.fork_no_credentials") }) : null,
          indeterminate ? el("span", { class: "muted small", text: count + "/" + keys.length }) : null
        );
      })
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
    boundKeys: resources.admin.keys.value.filter((key) => key.route_bindings.route_ids.includes(route.id)),
    boundGroups: (resources.admin.groups.value || []).filter((group) => (group.route_bindings?.route_ids || []).includes(route.id))
  }));
  renderCollection($("routes-body"), routes, {
    attrs: { class: "event-list settings-card-list", role: "list" },
    empty: m("ui.no_routing_rules"),
    render: ({ route, boundKeys, boundGroups }) => {
      const fields = [
        ["model", m("ui.model_access"), m("ui.all_models"), "astroid"],
        ["credential", m("ui.credential_access"), m("ui.fork_no_credentials_authorized"), "key"]
      ].map(([kind, label, fallback, iconName]) => {
        const items = routingDimensionChips(route.rule, kind, route.credential_labels);
        if (items.length && !items.some((item) => item.state === "allow")) items.unshift({ text: fallback, iconName });
        return settingsEntryField(label, settingsChipList(items, fallback));
      });
      const name = route.name || route.id;
      const groupChips = boundGroups.map((group) => ({
        text: group.name || group.id,
        tag: group.enabled === false ? m("ui.disabled") : ""
      }));
      return settingsCard(
        name,
        [
          ...fields,
          boundGroups.length ? settingsEntryField(m("ui.fork_groups"), settingsChipList(groupChips, "—")) : null,
          boundKeyField(boundKeys)
        ].filter(Boolean),
        () => editRoute(route),
        () =>
          openActionDialog(
            m("ui.delete_routing_rule_value", { v0: name }),
            boundKeys.length || boundGroups.length
              ? m("ui.remove_this_rule_from_value_of_these_value_non_deleted_keys_will_have_unrestricted_mo", {
                  v0: [boundKeys.length ? bindingSummary(boundKeys) : "", boundGroups.length ? groupBindingSummary(boundGroups) : ""]
                    .filter(Boolean)
                    .join(" / "),
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
$("group-rule-clear").onclick = () => {
  groupSelection.routeIDs.clear();
  Object.assign(groupSelection, routingSelection());
  groupSelection.orderMemo?.clear();
  renderGroupRuleList();
};
$("group-dialog").addEventListener("close", () => { if (!$("group-dialog").open) groupSelection = null; });
$("group-key-search").addEventListener("input", renderGroupKeyList);
$("group-key-filter").addEventListener("change", renderGroupKeyList);
$("group-key-all").onclick = () => {
  const editor = editors.get($("group-dialog"));
  if (!editor) return;
  for (const key of groupFilteredKeys(editor.data.keys, $("group-id").value, groupSelection.keyScopes)) {
    if (!key.deleted_at) groupSelection.keyScopes.add(key.scope);
  }
  renderGroupKeyList();
};
$("group-key-none").onclick = () => {
  const editor = editors.get($("group-dialog"));
  if (!editor) return;
  for (const key of groupFilteredKeys(editor.data.keys, $("group-id").value, groupSelection.keyScopes)) {
    groupSelection.keyScopes.delete(key.scope);
  }
  renderGroupKeyList();
};
$("group-save").onclick = () =>
  submitEditor("group-dialog", async (editor) => {
    const name = $("group-name").value.trim();
    if (!name) throw new UIError(m("ui.fork_enter_a_group_name"));
    const id = $("group-id").value;
    const description = $("group-description").value.trim();
    const enabled = $("group-enabled").checked;
    const routingMode = $("group-routing-mode").value || "ordinary";
    const bindings = { route_ids: [...groupSelection.routeIDs], ...routingPayload(groupSelection) };
    validateExclusiveGroupSelection(id, routingMode, bindings, editor.data.groups || []);
    const scopes = [...groupSelection.keyScopes];
    const data = { name, description, enabled, routing_mode: routingMode, route_bindings: bindings, scopes };
    if (id) {
      const group = editor.initial.group;
      if (sameScopes(scopes, editor.initial.scopes)) delete data.scopes;
      if (name === group.name) delete data.name;
      if (description === (group.description || "")) delete data.description;
      if (enabled === (group.enabled !== false)) delete data.enabled;
      if (routingMode === (group.routing_mode || "ordinary")) delete data.routing_mode;
      const previousBindings = {
        route_ids: group.route_bindings?.route_ids || [],
        ...routingPayload(routingSelection(group.route_bindings))
      };
      if (JSON.stringify(bindings) === JSON.stringify(previousBindings)) delete data.route_bindings;
      if (!Object.keys(data).length) return;
      await mutateAdmin("PATCH", "/groups", { id, ...data });
    } else { await mutateAdmin("POST", "/groups", data); }
    notify(id ? m("ui.fork_group_saved") : m("ui.fork_group_created"));
  });

$("group-picker-save").onclick = () =>
  submitEditor("group-picker", async (editor) => {
    const scopes = keyGroupSelection.scopes || [];
    if (!scopes.length) return;
    const inputs = Array.from($("group-picker-list").querySelectorAll('input[type="checkbox"]'));
    const checked = new Set(inputs.filter((input) => input.checked && !input.indeterminate).map((input) => input.value));
    const unchecked = new Set(inputs.filter((input) => !input.checked && !input.indeterminate).map((input) => input.value));
    for (const scope of scopes) {
      const key = editor.data.keys.find((item) => item.scope === scope);
      if (!key) continue;
      const next = new Set(key.group_ids || []);
      for (const id of checked) next.add(id);
      for (const id of unchecked) next.delete(id);
      await writeAdmin("PUT", "/keys/groups", { scope, group_ids: [...next] });
    }
    await loadDataGroup(false, "configuration", true);
    renderPage();
    notify(scopes.length === 1 ? m("ui.fork_api_key_groups_saved") : m("ui.fork_saved_groups_for_value_api_keys", { v0: scopes.length }));
  });
$("group-picker").addEventListener("close", () => { if (!$("group-picker").open) keyGroupSelection = { scopes: [] }; });

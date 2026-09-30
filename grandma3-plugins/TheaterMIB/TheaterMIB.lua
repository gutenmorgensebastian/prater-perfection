-- TheaterMIB – grandMA3 Plugin
--
-- Geht die Cueliste (Szenenwechsel) eines Theaterstücks durch und sucht
-- Movingheads, die in einer Szene dunkel sind (Dimmer 0) und in der nächsten
-- Szene benutzt werden. Für jeden solchen Szenenwechsel werden die Geräte
-- selektiert (lokalisiert) und es wird gefragt, in welcher Zeit sie im Dunkeln
-- auf Position / Shaper / Beam / Color der nächsten Szene fahren sollen.
-- Die Zeit wird als MIB (Move In Black) Fade/Delay in Part 0 der nächsten Cue
-- eingetragen – das eigentliche Vorpositionieren macht dann die Konsole.

local pluginName = select(1, ...)

local DEFAULT_GROUP = "MH"      -- Gruppe mit allen Movingheads
local DEFAULT_FADE  = "3"       -- Sekunden
local DEFAULT_DELAY = "0"       -- Sekunden nach "Dimmer zu"
local MIB_MODES     = { "Early", "Late" }

local function log(fmt, ...) Printf("[" .. pluginName .. "] " .. fmt, ...) end
local function err(fmt, ...) ErrPrintf("[" .. pluginName .. "] " .. fmt, ...) end

-- Cue-Nummer als Zahl (nil für OffCue / CueZero)
local function cueNumber(cue)
  local ok, s = pcall(function() return cue:Get("No", Enums.Roles.Display) end)
  local n = ok and tonumber(s) or nil
  if not n then
    local raw = tonumber(cue.No)
    if raw then n = (raw >= 1000) and raw / 1000 or raw end -- intern oft x1000
  end
  return n
end

local function cueLabel(cue)
  local n = cueNumber(cue)
  local name = cue.Name or ""
  return string.format("Cue %s%s", n and string.format("%g", n) or "?",
                       name ~= "" and (" '" .. name .. "'") or "")
end

-- Alle echten Cues (Nummer > 0) in Reihenfolge
local function collectCues(seq)
  local cues = {}
  for _, cue in ipairs(seq:Children()) do
    local n = cueNumber(cue)
    if n and n > 0 then cues[#cues + 1] = { handle = cue, no = n } end
  end
  table.sort(cues, function(a, b) return a.no < b.no end)
  return cues
end

-- Kommandozeilen-Name eines Geräts, z.B. "Fixture 101"
local function fixtureAddr(sub)
  local fid = sub.FID
  if fid ~= nil and tostring(fid) ~= "" and tostring(fid) ~= "None" then
    return "Fixture " .. tostring(fid)
  end
  return ToAddr(sub)
end

-- Liest für alle Geräte der Gruppe den Dimmerwert in einer Cue.
-- Läuft im Blind-Programmer, damit nichts live ausgegeben wird.
-- Rückgabe: { [fixtureAddr] = dimmer_prozent }
local function readDimmers(group, cue)
  local dimAttr = GetAttributeIndex("Dimmer")
  local result = {}
  Cmd("ClearAll")
  local r = Cmd(string.format('Group "%s" At %s', group, ToAddr(cue)))
  if r ~= "Ok" then err("'At %s' fehlgeschlagen: %s", ToAddr(cue), tostring(r)) end

  local sf = SelectionFirst()
  while sf do
    local ui = dimAttr and GetUIChannelIndex(sf, dimAttr)
    if ui then
      local value = 0
      local data = GetProgPhaser(ui, false)
      local step = data and data[1]
      if step and step.absolute then
        value = step.absolute
      elseif data and data.abs_preset then
        value = 100 -- Presetverweis ohne Wert: als "benutzt" werten
      end
      local addr = fixtureAddr(GetSubfixture(sf))
      result[addr] = math.max(result[addr] or 0, value)
    end
    sf = SelectionNext(sf)
  end
  return result
end

-- Findet alle Wechsel Cue K -> Cue K+1 mit Geräten, die von 0 auf >0 gehen
local function analyse(group, cues, startIndex)
  local transitions = {}
  local progress = StartProgress(pluginName .. ": Cues lesen")
  SetProgressRange(progress, startIndex, #cues)

  Cmd("Blind On")
  local prev = readDimmers(group, cues[startIndex].handle)
  for i = startIndex + 1, #cues do
    SetProgress(progress, i)
    local cur = readDimmers(group, cues[i].handle)
    local fixtures = {}
    for addr, value in pairs(cur) do
      if value > 0 and (prev[addr] or 0) <= 0 then fixtures[#fixtures + 1] = addr end
    end
    if #fixtures > 0 then
      table.sort(fixtures)
      transitions[#transitions + 1] = { from = cues[i - 1], to = cues[i], fixtures = fixtures }
    end
    prev = cur
  end
  Cmd("ClearAll")
  Cmd("Blind Off")
  StopProgress(progress)
  return transitions
end

-- Setzt eine Eigenschaft der Cue-Part; erst per Lua, sonst per Kommandozeile
local function setPartProperty(part, prop, value, undo)
  local ok = pcall(function() part:Set(prop, value) end)
  if ok then
    local got = part:Get(prop, Enums.Roles.Edit)
    if got ~= nil then return true end
  end
  local r = Cmd(string.format('Set %s Property "%s" "%s"', ToAddr(part), prop, value), undo)
  return r == "Ok"
end

local function applyMIB(t, settings, undo)
  local parts = t.to.handle:Children()
  local part = parts and parts[1] -- Part 0
  if not part then
    err("%s hat keine Part 0", cueLabel(t.to.handle))
    return false
  end
  local ok = true
  ok = setPartProperty(part, "MIB", settings.mode, undo) and ok
  ok = setPartProperty(part, "MIBFade", settings.fade, undo) and ok
  ok = setPartProperty(part, "MIBDelay", settings.delay, undo) and ok
  if ok then
    log("%s: MIB %s, Fade %ss, Delay %ss (%d Geräte)", cueLabel(t.to.handle),
        settings.mode, settings.fade, settings.delay, #t.fixtures)
  else
    err("%s: MIB konnte nicht vollständig gesetzt werden – bitte im Sequence Sheet prüfen",
        cueLabel(t.to.handle))
  end
  return ok
end

local function selectFixtures(fixtures)
  Cmd("ClearAll")
  Cmd(table.concat(fixtures, " + "))
end

local function askTransition(t, index, total, last)
  local list = table.concat(t.fixtures, ", ")
  local modeIndex = (last.mode == "Late") and 2 or 1
  local box = MessageBox({
    title = string.format("Move in Black %d/%d", index, total),
    message = string.format(
      "Szenenwechsel %s  ->  %s\n\n%d Movinghead(s) sind in der aktuellen Szene dunkel\n" ..
      "und werden in der nächsten benutzt (sind jetzt selektiert):\n\n%s\n\n" ..
      "In welcher Zeit sollen sie auf Position / Shaper / Beam / Color fahren?",
      cueLabel(t.from.handle), cueLabel(t.to.handle), #t.fixtures, list),
    inputs = {
      { name = "Fade (s)",  value = last.fade,  whiteFilter = "0123456789.", vkPlugin = "NumericInput", order = 1 },
      { name = "Delay (s)", value = last.delay, whiteFilter = "0123456789.", vkPlugin = "NumericInput", order = 2 },
    },
    selectors = {
      { name = "MIB Modus", selectedValue = modeIndex, type = 1, values = { ["Early"] = 1, ["Late"] = 2 } },
    },
    states = {
      { name = "Für alle weiteren Wechsel übernehmen", state = false },
    },
    commands = {
      { value = 1, name = "Setzen" },
      { value = 2, name = "Überspringen" },
      { value = 0, name = "Abbrechen" },
    },
  })
  if not box or not box.success or box.result == 0 then return "cancel" end
  if box.result == 2 then return "skip" end
  local settings = {
    fade  = tostring(tonumber(box.inputs["Fade (s)"]) or tonumber(last.fade)),
    delay = tostring(tonumber(box.inputs["Delay (s)"]) or tonumber(last.delay)),
    mode  = MIB_MODES[box.selectors["MIB Modus"] or modeIndex] or "Early",
  }
  return "set", settings, box.states["Für alle weiteren Wechsel übernehmen"]
end

local function Main(displayHandle, args)
  local seq = SelectedSequence()
  if not seq then
    err("Keine Sequenz selektiert. Bitte zuerst die Cueliste des Stücks selektieren.")
    return
  end

  local setup = MessageBox({
    title = pluginName,
    message = string.format(
      "Sequenz: %s\n\nDer Programmer wird geleert. Die Cues werden im Blind gelesen,\n" ..
      "live wird nichts ausgegeben.", ToAddr(seq, true)),
    inputs = {
      { name = "Movinghead-Gruppe", value = (args and args ~= "") and args or DEFAULT_GROUP, order = 1 },
    },
    selectors = {
      { name = "Bereich", selectedValue = 1, type = 1, values = { ["Ganze Sequenz"] = 1, ["Ab aktueller Cue"] = 2 } },
    },
    commands = { { value = 1, name = "Start" }, { value = 0, name = "Abbrechen" } },
  })
  if not setup or not setup.success or setup.result ~= 1 then return end
  local group = setup.inputs["Movinghead-Gruppe"]

  local cues = collectCues(seq)
  if #cues < 2 then
    err("Die Sequenz hat weniger als zwei Cues.")
    return
  end

  local startIndex = 1
  if setup.selectors["Bereich"] == 2 then
    local current = GetCurrentCue()
    local curNo = current and cueNumber(current)
    for i, c in ipairs(cues) do
      if curNo and c.no == curNo then startIndex = i end
    end
  end

  local transitions = analyse(group, cues, startIndex)
  if #transitions == 0 then
    MessageBox({ title = pluginName, message = "Keine Movingheads gefunden, die aus Dimmer 0 in die nächste Szene kommen.",
                 commands = { { value = 1, name = "OK" } } })
    return
  end
  log("%d Szenenwechsel mit Move in Black gefunden", #transitions)

  local undo = CreateUndo(pluginName)
  local last = { fade = DEFAULT_FADE, delay = DEFAULT_DELAY, mode = "Early" }
  local applyAll, done, skipped = false, 0, 0
  for i, t in ipairs(transitions) do
    selectFixtures(t.fixtures)
    local action, settings = "set", last
    if not applyAll then
      action, settings, applyAll = askTransition(t, i, #transitions, last)
    end
    if action == "cancel" then break end
    if action == "set" then
      last = settings
      if applyMIB(t, settings, undo) then done = done + 1 end
    else
      skipped = skipped + 1
    end
  end
  CloseUndo(undo)
  Cmd("ClearAll")

  log("Fertig: %d gesetzt, %d übersprungen, %d gefunden", done, skipped, #transitions)
end

return Main

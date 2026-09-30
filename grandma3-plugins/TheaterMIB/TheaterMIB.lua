-- TheaterMIB – grandMA3 Plugin
--
-- Geht die Cueliste (Szenenwechsel) eines Theaterstücks durch und sucht
-- Movingheads, die in einer Szene dunkel sind (Dimmer 0) und in der nächsten
-- Szene benutzt werden. Für jeden solchen Szenenwechsel werden die Geräte
-- selektiert (lokalisiert) und es wird gefragt, in welcher Zeit sie im Dunkeln
-- auf Position / Shaper / Beam / Color der nächsten Szene fahren sollen.
-- Die Werte der nächsten Szene (ohne Dimmer) werden mit dieser Zeit als
-- individuelles Fade/Delay in die Quell-Cue gespeichert. So sind die Mover
-- fertig positioniert, egal wann GO für die nächste Szene gedrückt wird.

local pluginName = select(1, ...)

local DEFAULT_GROUP = "MH"      -- Gruppe mit allen Movingheads
local DEFAULT_FADE  = "3"       -- Sekunden
local DEFAULT_DELAY = "0"       -- Sekunden, bevor die Mover losfahren

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

-- Findet alle Wechsel Cue K -> Cue K+1 mit Geräten, die von 0 auf >0 gehen.
-- fadeOut: Geräte, die in Cue K selbst erst ausgeblendet werden (brauchen Delay)
local function analyse(group, cues, startIndex)
  local transitions = {}
  local progress = StartProgress(pluginName .. ": Cues lesen")
  SetProgressRange(progress, startIndex, #cues)

  Cmd("Blind On")
  local before = startIndex > 1 and readDimmers(group, cues[startIndex - 1].handle) or {}
  local prev = readDimmers(group, cues[startIndex].handle)
  for i = startIndex + 1, #cues do
    SetProgress(progress, i)
    local cur = readDimmers(group, cues[i].handle)
    local fixtures, fadeOut = {}, {}
    for addr, value in pairs(cur) do
      if value > 0 and (prev[addr] or 0) <= 0 then
        fixtures[#fixtures + 1] = addr
        if (before[addr] or 0) > 0 then fadeOut[addr] = true end
      end
    end
    if #fixtures > 0 then
      table.sort(fixtures)
      transitions[#transitions + 1] = { from = cues[i - 1], to = cues[i], fixtures = fixtures, fadeOut = fadeOut }
    end
    before, prev = prev, cur
  end
  Cmd("ClearAll")
  Cmd("Blind Off")
  StopProgress(progress)
  return transitions
end

-- Ist im Programmer noch ein Dimmerwert aktiv?
local function dimmerInProgrammer()
  local dimAttr = GetAttributeIndex("Dimmer")
  local sf = SelectionFirst()
  while sf do
    local ui = dimAttr and GetUIChannelIndex(sf, dimAttr)
    local data = ui and GetProgPhaser(ui, false)
    if data then
      if data.mask_active_value ~= nil then
        if data.mask_active_value ~= 0 then return true end
      elseif (data[1] and data[1].absolute) or data.abs_preset then
        return true
      end
    end
    sf = SelectionNext(sf)
  end
  return false
end

-- Speichert Position/Shaper/Beam/Color der Ziel-Cue (ohne Dimmer) mit
-- individueller Zeit in die Quell-Cue.
local function storeIntoSourceCue(t, settings, undo)
  local function run(cmd)
    local r = Cmd(cmd, undo)
    if r ~= "Ok" then err("'%s' -> %s", cmd, tostring(r)) end
    return r == "Ok"
  end

  Cmd("Blind On", undo)
  Cmd("ClearAll", undo)
  local ok = run(table.concat(t.fixtures, " + "))
    and run("At " .. ToAddr(t.to.handle))
    and run('Off Attribute "Dimmer"')
  Cmd('Off FeatureGroup "Control"', undo) -- Lampe/Reset o.ä. nicht mitnehmen

  if ok and dimmerInProgrammer() then
    err("%s: Dimmer liess sich nicht aus dem Programmer entfernen – nichts gespeichert",
        cueLabel(t.from.handle))
    ok = false
  end
  ok = ok and run("Fade " .. settings.fade) and run("Delay " .. settings.delay)
    and run("Store " .. ToAddr(t.from.handle) .. " /Merge")

  Cmd("ClearAll", undo)
  Cmd("Blind Off", undo)

  if ok then
    log("%s: %d Mover fahren in %ss (Delay %ss) auf %s", cueLabel(t.from.handle),
        #t.fixtures, settings.fade, settings.delay, cueLabel(t.to.handle))
  end
  return ok
end

local function selectFixtures(fixtures)
  Cmd("ClearAll")
  Cmd(table.concat(fixtures, " + "))
end

local function askTransition(t, index, total, last)
  local names, anyFadeOut = {}, false
  for _, addr in ipairs(t.fixtures) do
    if t.fadeOut[addr] then names[#names + 1] = addr .. " *"; anyFadeOut = true
    else names[#names + 1] = addr end
  end
  local box = MessageBox({
    title = string.format("Szenenwechsel %d/%d", index, total),
    message = string.format(
      "%s  ->  %s\n\n%d Movinghead(s) sind in %s dunkel und werden in der\n" ..
      "nächsten Szene benutzt (sind jetzt selektiert):\n\n%s\n\n" ..
      "Position / Shaper / Beam / Color der nächsten Szene werden in\n" ..
      "%s gespeichert. In welcher Zeit sollen die Mover dort hinfahren?%s",
      cueLabel(t.from.handle), cueLabel(t.to.handle), #t.fixtures,
      cueLabel(t.from.handle), table.concat(names, ", "), cueLabel(t.from.handle),
      anyFadeOut and "\n\n* wird in dieser Cue erst ausgeblendet – Delay mindestens\n  so lang wie das Ausfaden setzen!" or ""),
    inputs = {
      { name = "Fade (s)",  value = last.fade,  whiteFilter = "0123456789.", vkPlugin = "NumericInput", order = 1 },
      { name = "Delay (s)", value = last.delay, whiteFilter = "0123456789.", vkPlugin = "NumericInput", order = 2 },
    },
    states = {
      { name = "Für alle weiteren Wechsel übernehmen", state = false },
    },
    commands = {
      { value = 1, name = "Speichern" },
      { value = 2, name = "Überspringen" },
      { value = 0, name = "Abbrechen" },
    },
  })
  if not box or not box.success or box.result == 0 then return "cancel" end
  if box.result == 2 then return "skip" end
  local settings = {
    fade  = tostring(tonumber(box.inputs["Fade (s)"]) or tonumber(last.fade)),
    delay = tostring(tonumber(box.inputs["Delay (s)"]) or tonumber(last.delay)),
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
      "Sequenz: %s\n\nDer Programmer wird geleert. Lesen und Speichern passiert im\n" ..
      "Blind, live wird nichts ausgegeben. Alles ist ein Oops-Schritt.", ToAddr(seq, true)),
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
  log("%d Szenenwechsel mit Movern aus dem Dunkeln gefunden", #transitions)

  local undo = CreateUndo(pluginName)
  local last = { fade = DEFAULT_FADE, delay = DEFAULT_DELAY }
  local applyAll, done, skipped = false, 0, 0
  for i, t in ipairs(transitions) do
    if not applyAll then selectFixtures(t.fixtures) end
    local action, settings = "set", last
    if not applyAll then
      action, settings, applyAll = askTransition(t, i, #transitions, last)
    end
    if action == "cancel" then break end
    if action == "set" then
      last = settings
      if storeIntoSourceCue(t, settings, undo) then done = done + 1 end
    else
      skipped = skipped + 1
    end
  end
  CloseUndo(undo)
  Cmd("ClearAll")

  log("Fertig: %d gesetzt, %d übersprungen, %d gefunden", done, skipped, #transitions)
end

return Main

import { App, Plugin, PluginSettingTab, Setting, moment, MarkdownRenderer } from 'obsidian';

interface HabitTrackerPluginSettings {
  startOfWeek: string;
  monthFormat: string;
  displayHead: boolean;
  enableHTML: boolean;
  enableMarkdown: boolean;
  Sunday: string;
  Monday: string;
  Tuesday: string;
  Wednesday: string;
  Thursday: string;
  Friday: string;
  Saturday: string;
}

const DEFAULT_SETTINGS: HabitTrackerPluginSettings = {
  startOfWeek: '0',
  monthFormat: 'YYYY-MM',
  displayHead: true,
  enableHTML: false,
  enableMarkdown: true,
  Sunday: 'SUN',
  Monday: 'MON',
  Tuesday: 'TUE',
  Wednesday: 'WED',
  Thursday: 'THU',
  Friday: 'FRI',
  Saturday: 'SAT'
}

interface Entry {
  date: string
  content: string
  link: string
}

interface CalendarData {
  year: number
  month: number
  width: string
  filepath: string
  format: string
  entries: Entry[]
  date_pattern: string
}

interface CalendarParam {
  year: number
  month: number
  format: string  // the way you want the content to be rendered
  width: string   // width of the calendar, default 100%
  note_pattern: string    // deprecated use date_pattern instead
  date_pattern: string    // your daily note file name pattern, leave empty to use 'YYYY-MM-DD' pattern
  data: any // can be (1) array of Entry. (2) Table
}

export default class HabitTrackerPlugin extends Plugin {
  settings: HabitTrackerPluginSettings;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new HabitTrackerSettingTab(this.app, this));


    //@ts-ignore
    window.renderHabitCalendar = (el: HTMLElement, dv: any, calendarParam: CalendarParam): void => {
      const filepath = dv.current().file.path
      let calendarData = param2CalendarData(dv, calendarParam)
      let ctx = fromCalendarData(calendarData, this.settings)

      const styles = ctx.tableWidth ? `width: ${ctx.tableWidth};` : '';
      const table = createEl('table', { cls: 'habitt', attr: { style: styles } })
      table.appendChild(renderHead(ctx))
      table.appendChild(renderBody(ctx))
      el.appendChild(table);
    }

  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

interface HabitTrackerContext {
  startOfWeek: number;
  startDay: number;
  monthDays: number;
  displayMonth: string;
  tableWidth: string,
  marks: Map<number, Entry>;
  settings: HabitTrackerPluginSettings,
  error: string,
  calendarData: CalendarData,
  filepath: string,
}

function createContext(calendarData: CalendarData, settings: HabitTrackerPluginSettings): HabitTrackerContext {
  return {
    startOfWeek: parseInt(settings.startOfWeek, 10),
    startDay: 0,
    monthDays: 0,
    displayMonth: '',
    tableWidth: '',
    marks: new Map<number, Entry>(),
    settings,
    error: '',
    calendarData,
    filepath: calendarData.filepath
  };
}

function isTableData(data: any): boolean {
  return data.successful && data.value && data.value.type == 'table'
}

function param2CalendarData(dv: any, params: CalendarParam): CalendarData {
  const calendarData: CalendarData = {
    year: params.year,
    month: params.month,
    filepath: dv.current().file.path,
    width: params.width || "100%",
    entries: params.data,
    format: params.format || 'text',
    date_pattern: params.date_pattern || params.note_pattern || 'YYYY-MM-DD'
  }
  if (isTableData(params.data)) {
    const headers = params.data.value.headers
    const values = params.data.value.values
    type StringToEntry = {
      [key: string]: Entry
    }
    const dataDict: StringToEntry = {}
    for (let ri = 0; ri < values.length; ri += 1) {
      // fill calendar day
      const value = values[ri]
      const link = value[0]
      const date = moment(link.fileName(), calendarData.date_pattern)
      if (!date.isValid()) {
        continue
      }
      const dateString = link.fileName()
      let entry: Entry = dataDict[dateString]
      if (!entry) {
        entry = {
          'date': dateString,
          'content': '',
          'link': link.path
        }
        dataDict[dateString] = entry
      }

      // fill content
      for (let ci = 1; ci < value.length; ci++) {
        if (value[ci]) {
          // if the header contains a "|", use the string after "|" as label
          const splited = headers[ci].split("|")
          const label = splited[splited.length-1]
          entry.content += `${label} ${value[ci]}\n`
        }
      }
    }
    calendarData.entries = Object.values(dataDict)
    calendarData.format = 'text'
  }
  return calendarData
}

function fromCalendarData(calendarData: CalendarData, settings: HabitTrackerPluginSettings): HabitTrackerContext {
  const ctx = createContext(calendarData, settings)

  const mon = moment(`${calendarData.year}-${calendarData.month}`, 'YYYY-M')
  if (!mon.isValid()) {
    ctx.error = `Fail: Invalid Date ${calendarData.year}-${calendarData.month}`;
    return ctx;
  }

  ctx.displayMonth = mon.format(settings.monthFormat);
  ctx.startDay = mon.startOf('month').day();
  ctx.monthDays = mon.endOf('month').date();

  // table width (optional)
  if (calendarData.width) {
    ctx.tableWidth = calendarData.width
  }

  // punch in
  calendarData.entries.forEach(entry => {
    const d = moment(entry.date, calendarData.date_pattern)
    if (d.year() == calendarData.year && d.month() + 1 == calendarData.month) {
      ctx.marks.set(d.date(), entry)
    }
  })

  return ctx;
}

function renderHead(ctx: HabitTrackerContext): HTMLElement {
  const { Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday } = ctx.settings;
  const WEEK = [Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday];

  const thead = createEl('thead');

  if (ctx.settings.displayHead) {
    const tr = thead.createEl('tr');
    tr.createEl('th', { cls: 'habitt-head', attr: { colspan: 7 }, text: ctx.displayMonth });
  }

  const tr = thead.createEl('tr');
  for (let i = 0; i < 7; i++) {
    tr.createEl('th', { cls: `habitt-th habitt-th-${i}`, text: WEEK[(i + ctx.startOfWeek) % 7] });
  }
  return thead;
}

function renderBody(ctx: HabitTrackerContext): HTMLElement {
  const startHolds = ctx.startDay >= ctx.startOfWeek ? ctx.startDay - ctx.startOfWeek : 7 - ctx.startOfWeek + ctx.startDay;
  let days = (new Array(ctx.monthDays)).fill(0).map((v, i) => i + 1);
  const weeks: number[][] = [];

  if (startHolds) {
    const startWeekDays = 7 - startHolds;
    const firstWeek: number[] = (new Array(startHolds)).fill(0);
    weeks.push(firstWeek.concat(days.slice(0, startWeekDays)));
    days = days.slice(startWeekDays);
  }

  let i = 0;
  while (i < days.length) {
    weeks.push(days.slice(i, i + 7));
    i = i + 7;
  }

  const lastWeek = weeks[weeks.length - 1];
  if (lastWeek.length < 7) {
    const pad = 7 - lastWeek.length;
    for (let i = 0; i < pad; i++) {
      lastWeek.push(0);
    }
  }

  const tbody = createEl('tbody');
  const { enableHTML } = ctx.settings
  for (let i = 0; i < weeks.length; i++) {
    const tr = tbody.createEl('tr');
    for (let j = 0; j < weeks[i].length; j++) {
      const d = weeks[i][j];
      const hasOwn = ctx.marks.has(d);
      const td = tr.createEl('td', { cls: `habitt-td habitt-td--${d || 'disabled'} ${hasOwn ? 'habitt-td--checked' : ''}` });
      const div = td.createDiv({ cls: 'habitt-c' });
      // create link to file
      if (hasOwn) {
        const day_div = div.createDiv({ cls: 'habitt-date' });
        const link = ctx.marks.get(d).link ? ctx.marks.get(d).link : ctx.marks.get(d).date
        day_div.createEl('a', { text: `${d || ''}`, cls: "internal-link", href: link, attr: { "data-href": link, "target": "_blank", "rel": "noopener" } })
      } else {
        div.createDiv({ cls: 'habitt-date', text: `${d || ''}` });
      }
      const dots = div.createDiv({ cls: 'habitt-dots' });
      if (hasOwn) {
        const input = ctx.marks.get(d).content
        // treat as HTML
        if (enableHTML && ctx.calendarData.format == 'html') {
          dots.innerHTML = `<div>${input}</div>`
        } else if (ctx.settings.enableMarkdown && ctx.calendarData.format == 'markdown') {
          const md_div = dots.createDiv();
          MarkdownRenderer.renderMarkdown(input, md_div, ctx.filepath, this)
        } else {
          dots.createDiv({ cls: 'habit-content', text: input })
        }
      }
    }
  }
  return tbody;
}

class HabitTrackerSettingTab extends PluginSettingTab {
  plugin: HabitTrackerPlugin;

  constructor(app: App, plugin: HabitTrackerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});
    const weeks: Record<string, string> = {
      '0': 'Sunday',
      '1': 'Monday',
      '2': 'Tuesday',
      '3': 'Wednesday',
      '4': 'Thursday',
      '5': 'Friday',
      '6': 'Saturday'
    };
    new Setting(containerEl)
      .setName('Start Of Week')
      .setDesc('The day a week begins.')
      .addDropdown(
        dropdown => dropdown
          .addOptions(weeks)
          .setValue(this.plugin.settings.startOfWeek)
          .onChange(async (value) => {
            this.plugin.settings.startOfWeek = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Display Table Header')
      .addToggle(
        dropdown => dropdown
          .setValue(this.plugin.settings.displayHead)
          .onChange(async (value) => {
            this.plugin.settings.displayHead = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Enable HTML')
      .setDesc('Treat your input text as HTML. Be careful, it may cause DOM injection attacks')
      .addToggle(
        dropdown => dropdown
          .setValue(this.plugin.settings.enableHTML)
          .onChange(async (value) => {
            this.plugin.settings.enableHTML = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Enable Markdown Rendering')
      .setDesc('Treat your input text as Markdown.')
      .addToggle(
        dropdown => dropdown
          .setValue(this.plugin.settings.enableMarkdown)
          .onChange(async (value) => {
            this.plugin.settings.enableMarkdown = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Month Format')
      .setDesc('To format the month text which displays in the header')
      .addText(text => text
        .setValue(this.plugin.settings.monthFormat)
        .onChange(async (value) => {
          this.plugin.settings.monthFormat = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sunday Label')
      .setDesc('Default is SUN')
      .addText(text => text
        .setValue(this.plugin.settings.Sunday)
        .onChange(async (value) => {
          this.plugin.settings.Sunday = value || DEFAULT_SETTINGS.Sunday;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Monday Label')
      .setDesc('Default is MON')
      .addText(text => text
        .setValue(this.plugin.settings.Monday)
        .onChange(async (value) => {
          this.plugin.settings.Monday = value || DEFAULT_SETTINGS.Monday;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Tuesday Label')
      .setDesc('Default is TUE')
      .addText(text => text
        .setValue(this.plugin.settings.Tuesday)
        .onChange(async (value) => {
          this.plugin.settings.Tuesday = value || DEFAULT_SETTINGS.Tuesday;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Wednesday Label')
      .setDesc('Default is WED')
      .addText(text => text
        .setValue(this.plugin.settings.Wednesday)
        .onChange(async (value) => {
          this.plugin.settings.Wednesday = value || DEFAULT_SETTINGS.Wednesday;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Thursday Label')
      .setDesc('Default is THU')
      .addText(text => text
        .setValue(this.plugin.settings.Thursday)
        .onChange(async (value) => {
          this.plugin.settings.Thursday = value || DEFAULT_SETTINGS.Thursday;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Friday Label')
      .setDesc('Default is FRI')
      .addText(text => text
        .setValue(this.plugin.settings.Friday)
        .onChange(async (value) => {
          this.plugin.settings.Friday = value || DEFAULT_SETTINGS.Friday;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Saturday Label')
      .setDesc('Default is SAT')
      .addText(text => text
        .setValue(this.plugin.settings.Saturday)
        .onChange(async (value) => {
          this.plugin.settings.Saturday = value || DEFAULT_SETTINGS.Saturday;
          await this.plugin.saveSettings();
        }));
  }
}

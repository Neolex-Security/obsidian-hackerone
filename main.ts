import {
	App,
	Plugin,
	Setting,
	PluginSettingTab,
	requestUrl,
	Notice
} from 'obsidian';

interface H1ObsidianPluginSettings {
	h1Username: string;
	h1Token: string;
	directory: string;
}
const DEFAULT_SETTINGS: H1ObsidianPluginSettings = {
	h1Username: '',
	h1Token: '',
	directory: 'Bug Bounty'
};


export class H1ObsidianPluginSettingTab extends PluginSettingTab {
	plugin: H1ObsidianPlugin;

	constructor(app: App, plugin: H1ObsidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;

	}

	display(): void {
		const {
			containerEl
		} = this;

		containerEl.empty();

		containerEl.createEl('h2', {
			text: 'HackerOne Plugin Settings'
		});

		new Setting(containerEl)
			.setName('HackerOne Username')
			.setDesc('Enter your HackerOne username')
			.addText((text) =>
				text
				.setPlaceholder('Enter your username...')
				.setValue(this.plugin.settings.h1Username)
				.onChange(async (value) => {
					this.plugin.settings.h1Username = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('HackerOne Token')
			.setDesc('Enter your HackerOne API token')
			.addText((text) =>
				text
				.setPlaceholder('Enter your token...')
				.setValue(this.plugin.settings.h1Token)
				.onChange(async (value) => {
					this.plugin.settings.h1Token = value;
					await this.plugin.saveSettings();
				})
			);

			new Setting(containerEl)
			.setName('path')
			.setDesc('Enter the path of the bug bounty folder')
			.addText((text) =>
				text
				.setPlaceholder('./Bug Bounty')
				.setValue(this.plugin.settings.directory)
				.onChange(async (value) => {
					this.plugin.settings.directory = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
const contentBugSummaryAlltime =  "# Bugs \n\
```dataview\n\
TABLE program,state,bounty,severity,URL,created_at\n\
WHERE Type=\"bug-bounty-vuln\"\n\
SORT DateReported DESC\n\
```\n\
# Total \n\
```dataview\n\
TABLE sum(rows.bounty) as TotalBounty\n\
WHERE Type=\"bug-bounty-vuln\" \n\
Where bounty > 0\n\
GROUP BY TotalBounty\n\
```\n\
# Best Programs\n\
```dataview\n\
TABLE  sum(rows.bounty) as TotalBounty\n\
WHERE type=\"bug-bounty-vuln\"and bounty > 0\n\
GROUP BY program\n\
SORT sum(rows.bounty) DESC\n\
``` \n\
\n\
"
const conttentBugSummary2023 =  "# Bugs\n\
```dataview\n\
TABLE program,state,bounty,severity,URL,created_at\n\
WHERE Type=\"bug-bounty-vuln\" and contains(dateformat(created_at,\"yyyy\"),\"2023\")\n\
SORT DateReported DESC\n\
```\n\
# Total 2023\n\
```dataview\n\
TABLE sum(rows.bounty) as TotalBounty\n\
WHERE Type=\"bug-bounty-vuln\" \n\
Where bounty > 0 and contains(dateformat(bounty_awarded_at,\"yyyy\"),\"2023\") \n\
GROUP BY TotalBounty\n\
```\n\
# Best Programs 2023\n\
```dataview\n\
TABLE  sum(rows.bounty) as TotalBounty\n\
WHERE type=\"bug-bounty-vuln\" and contains(dateformat(created_at,\"yyyy\"),\"2023\")  and bounty > 0\n\
GROUP BY program\n\
SORT sum(rows.bounty) DESC\n\
``` \n\
\n\
"
export default class H1ObsidianPlugin extends Plugin {
	settings: H1ObsidianPluginSettings;
	async onload() {
		await this.loadSettings();

		try {
			this.app.vault.createFolder(`${this.settings.directory}/Bugs`);
		} catch (error) {
			console.log("Error folder bug directory creation:",console.log(error))
		}

		this.addSettingTab(new H1ObsidianPluginSettingTab(this.app, this));

;
		try {
			await this.app.vault.create(`${this.settings.directory}/bugs-summary-all-time.md`, contentBugSummaryAlltime);
		} catch (error) {
			console.log('Error creating summary file:', error);
		}
		try {
			await this.app.vault.create(`${this.settings.directory}/bugs-summary-2023.md`, conttentBugSummary2023);
		} catch (error) {
			console.log('Error creating summary file:', error);
		}

		this.addCommand({
			id: 'fetch-h1-reports',
			name: 'fetch HackerOne Reports',
			callback: () => this.fetchH1Reports(),
		});

	}

	async overwriteFile(fileName : string, fileContent: string) {
		// Check if the file exists
		let file = this.app.vault.getAbstractFileByPath(fileName);
	
		if (file) {
		  // If the file exists, delete it
		  await this.app.vault.delete(file);
		}
	
		try {
		  // Create a new file with the same name
		  const newFile = await this.app.vault.create(fileName, fileContent);
		} catch (err) {
		  new Notice('Error: Unable to overwrite the file.');
		  console.error('Error overwriting file:', err);
		}
	  }
	
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async fetchH1Reports() {
		if (this.settings.h1Username == ''){
			new Notice("You need to fill your hackerone username in the settings of the plugin")
			console.log("You need to fill your hackerone username in the settings of the plugin");
			return
		}
		if (this.settings.h1Token == ''){
			new Notice("You need to fill your hackerone API Token in the settings of the plugin")
			console.log("You need to fill your hackerone API Token in the settings of the plugin")
			return 
		}
		new Notice("fetching your HackerOne Reports...")
		try {
			const h1Reports = await this.getH1Reports();
			const h1Earnings = await this.getH1Earnings();
			// Create a folder for the reports if it doesn't exist
			await this.createNotes(h1Reports, h1Earnings)


		} catch (error) {
			console.log(error);
			new Notice('Error fetching HackerOne reports: ' + error.message);
		}
	}

	async createNotes(h1Reports: [], earnings: []) {

		const vault = this.app.vault;
		const folderPath = `${this.settings.directory}/Bugs`;
		for (const item of h1Reports) {
			try {
				var severity = item.relationships.severity.data.attributes.rating
			} catch (error) {
				severity = "undefined"
			}
			try {
				var program = item.relationships.program.data.attributes.handle
			} catch (error) {
				program = "undefined"
			}
			const noteContent = '---\nType: bug-bounty-vuln\n' + await this.serializeAttributes(item.attributes) + 'bounty: ' + await this.getBountyReport(item.id, earnings) + '\nseverity: ' + severity + '\nprogram: ' + program + '\n---\nn' + item.attributes.vulnerability_information;
			var fileName = `${folderPath}/${item.attributes.title.replace(/[^a-z0-9_-]/gi, '_')}-${item.id}.md`
			console.log(`Create bugs ${item.attributes.title}.`)
			await this.overwriteFile(fileName, noteContent);
		}
		new Notice('Bugs has been updated successfully.');
	
	}

	async getBountyReport(reportId, earnings) {
		let ret = 0;

		for (const earning of earnings) {
			if (earning.type === 'earning-bounty-earned') {
				if (
					earning.relationships.bounty.data.relationships.report.data.id ===
					reportId
				) {
					ret += parseInt(earning.attributes.amount);

					if (earning.attributes.bonus_amount !== undefined) {
						ret += parseInt(earning.attributes.bonus_amount);
					}
				}
			} else if (earning.type === 'earning-retest-completed') {
				if (
					earning.relationships.report_retest_user.data.relationships.report_retest.data.relationships.report.data.id ===
					reportId
				) {
					ret += 50;
				}
			} else {
				console.log(earning.type);
			}
		}

		return ret;
	}

	async serializeAttributes(attributes: []) {
		let yamlString = '';

		for (const key in attributes) {
			if (key != "vulnerability_information") {
				yamlString += `${key}: ${attributes[key]}\n`;
			}
		}

		return yamlString;
	}


	async getH1Reports() {
		// fetch reports from the HackerOne API
		const authString = btoa(`${this.settings.h1Username}:${this.settings.h1Token}`);

		let page = 0;
		let h1ReportsRet = [];
		
		while (true) {
			page += 1;
			const response = await requestUrl({
				url: `https://api.hackerone.com/v1/hackers/me/reports?page[size]=100&page[number]=${page}`,
				method: "GET",
				headers: {

					Authorization: `Basic ${authString}`,
					Accept: 'application/json',
				}
			});
			if (response.status != 200) {
				console.log("Error fetching hackerone api");
				new Notice("Error fetching hackerone api");

			}
			if (response.json.data.length == 0) {
				return h1ReportsRet
			}
			h1ReportsRet = h1ReportsRet.concat(response.json.data)
		}
	}

	async getH1Earnings() {
		// fetch reports from the HackerOne API
		const authString = btoa(`${this.settings.h1Username}:${this.settings.h1Token}`);

		let page = 0;
		let earnings = [];

		while (true) {
			page += 1;
			const response = await requestUrl({
				url: `https://api.hackerone.com/v1/hackers/payments/earnings?page[size]=100&page[number]=${page}`,
				method: "GET",
				headers: {

					Authorization: `Basic ${authString}`,
					Accept: 'application/json',
				}
			});
			if (response.status != 200) {
				console.log("Error fetching hackerone api");

			}
			if (response.json.data.length == 0) {
				return earnings
			}
			earnings = earnings.concat(response.json.data)
		}
	}
}

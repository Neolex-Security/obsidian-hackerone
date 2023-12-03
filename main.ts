import {
	App,
	Plugin,
	Setting,
	PluginSettingTab,
	requestUrl,
	Notice,
	TFile,
	normalizePath
} from 'obsidian';
import { emitWarning } from 'process';

interface ReportNote {
	id: string;
	content: string;
	filename: string;
}


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
const contentBugSummaryAlltime = "# Bugs \n\
```dataview\n\
TABLE program,state,bounty,severity,url,created_at\n\
WHERE Type=\"bug-bounty-vuln\"\n\
SORT created_at DESC\n\
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

const contentBugSummaryCurrentYear = "# " + new Date().getFullYear() + " bug reports\n\
\n\
# Bugs\n\
```dataview\n\
TABLE program,state,bounty,severity,url,created_at\n\
WHERE Type=\"bug-bounty-vuln\" and contains(dateformat(created_at,\"yyyy\"),\""+ new Date().getFullYear() + "\")\n\
SORT created_at DESC\n\
```\n\
# Total \n\
```dataview\n\
TABLE sum(rows.bounty) as TotalBounty\n\
WHERE Type=\"bug-bounty-vuln\" \n\
Where bounty > 0 and contains(dateformat(bounty_awarded_at,\"yyyy\"),\""+ new Date().getFullYear() + "\") \n\
GROUP BY TotalBounty\n\
```\n\
# Best Programs \n\
```dataview\n\
TABLE  sum(rows.bounty) as TotalBounty\n\
WHERE type=\"bug-bounty-vuln\" and contains(dateformat(created_at,\"yyyy\"),\""+ new Date().getFullYear() + "\")  and bounty > 0\n\
GROUP BY program\n\
SORT sum(rows.bounty) DESC\n\
``` \n\
\n\
"
export default class H1ObsidianPlugin extends Plugin {
	settings: H1ObsidianPluginSettings;
	async onload() {
		await this.loadSettings();
		
		this.addSettingTab(new H1ObsidianPluginSettingTab(this.app, this));

		try {
			await this.app.vault.create(normalizePath(`${this.settings.directory}/bugs-summary-all-time.md`), contentBugSummaryAlltime);
		} catch (error) {
			new Notice('Error creating summary file:', error);
		}
		try {
			await this.app.vault.create(normalizePath(`${this.settings.directory}/bugs-summary-current-year.md`), contentBugSummaryCurrentYear);
		} catch (error) {
			new Notice('Error creating summary file:', error);
		}

		this.registerInterval(
			window.setInterval(() => this.fetchH1Reports(), 10*60*1000)
		);
		
		this.addCommand({
			id: 'fetch-h1-reports',
			name: 'Fetch hackerone reports',
			callback: () => this.fetchH1Reports(),
		});

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async fetchH1Reports() {
		console.log("fetch hackerone reports...")
		if (this.settings.h1Username == '') {
			new Notice("You need to fill your hackerone username in the settings of the plugin")
			return
		}
		if (this.settings.h1Token == '') {
			new Notice("You need to fill your hackerone API Token in the settings of the plugin")
			return
		}
		let h1Earnings = []
		let h1Reports = []
		new Notice("Fetching your HackerOne reports...")
		try {
			h1Reports = await this.getH1Reports();
			h1Earnings = await this.getH1Earnings();
		} catch (error) {
			new Notice('Error fetching HackerOne reports: ' + error.message);
		}
		try{
			// Create a folder for the reports if it does	n't exist
			await this.createNotes(h1Reports, h1Earnings)
		}catch(error){
			new Notice('Error creating notes: ' + error.message);
		}
	}

	async createNotes(h1Reports: any[], earnings: any[]) {
		var reportNotes: ReportNote[] = [];
		const vault = this.app.vault;
		
		const folderPath = normalizePath(`${this.settings.directory}/Bugs`);
		try{
			await vault.createFolder(folderPath);
		}catch(error){
			
		}
		let severity = "undefined"
		for (const item of h1Reports) {
			try {
				severity = item.relationships.severity.data.attributes.rating
			} catch (error) {
			}
			let program = "undefined"
			try {
				program = item.relationships.program.data.attributes.handle
			} catch (error) {
			
			}
			const specialChars = /([\'\[\]\/])/g;
			const title = item.attributes.title.replace(":","").replace(specialChars, '\\$1')
			const noteContent = '---\nType: bug-bounty-vuln\ntitle: '+ title + '\nurl: https://hackerone.com/reports/'+item.id +'\n' + await this.serializeAttributes(item.attributes) + 'bounty: ' + await this.getBountyReport(item.id, earnings) + '\nseverity: ' + severity + '\nprogram: ' + program + '\n---\n' + item.attributes.vulnerability_information.replace("<%", "<");

			
			let fileName = `${folderPath}/${item.attributes.title.replace(/[^a-z0-9_ -]/gi, '_')}-${item.id}.md`
			const newReportNote: ReportNote = {
				id: item.id,
				content: noteContent,
				filename: fileName,
			};
			reportNotes.push(newReportNote);
			
		}
		await this.overwriteFiles(reportNotes);

	}

	async overwriteFiles(reportNotes: Array<ReportNote>) {
		try {
			const folderPath = normalizePath(`${this.settings.directory}/Bugs`);
			let existingReportFiles = this.app.vault.getMarkdownFiles()
			existingReportFiles = existingReportFiles.filter(file => file.path.startsWith(folderPath));
			for (const reportNote of reportNotes) {
				const foundExistingReport = existingReportFiles.find((reportFile: TFile) => reportFile.basename.split("-").pop() === reportNote.id);
				if(foundExistingReport){
					let currentContent = await this.app.vault.cachedRead(foundExistingReport);
					if(currentContent!=reportNote["content"]){
						await this.app.vault.modify(foundExistingReport, reportNote["content"]);
					}
				
				}else{
					console.log("report "+reportNote["id"]+" not found create "+reportNote["filename"])
					await this.app.vault.create(reportNote["filename"],reportNote["content"])
				}		
			}
		} catch (err) {
			new Notice('Error: Unable to overwrite the file:'+err);
			console.log('Error overwriting file:', err);
		}
	}

	async getBountyReport(reportId: number, earnings: any[]) {
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
				new Notice(earning.type);
			}
		}
		return ret;
	}

	

	async serializeAttributes(attributes: any[]) {
		let yamlString = '';
		for (const key in attributes) {
			if (key != "vulnerability_information" && key != "title") {
				let content = attributes[key]
				yamlString += `${key}: ${content}\n`;
			}
		}

		return yamlString;
	}

	async getH1Reports(): Promise<any[]> {
		console.log("fetch reports...")
		// fetch reports from the HackerOne API
		const authString = btoa(`${this.settings.h1Username}:${this.settings.h1Token}`);

		let page = 0;
		let h1ReportsRet: any[] = [];

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
				new Notice("Error fetching hackerone api");
				new Notice("Error fetching hackerone api");

			}
			if (response.json.data.length == 0) {
				return h1ReportsRet
			}
			
			h1ReportsRet = h1ReportsRet.concat(response.json.data)
		}
	}

	async getH1Earnings(): Promise<any[]> {
		// fetch reports from the HackerOne API
		const authString = btoa(`${this.settings.h1Username}:${this.settings.h1Token}`);

		let page = 0;
		let earnings: any[] = [];

		while (true) {
			page += 1;
			const response = await requestUrl({
				url: `https://api.hackerone.com/v1/hackers/payments/earnings?page%5Bsize%5D=100&page%5Bnumber%5D=${page}`,
				method: "GET",
				headers: {

					Authorization: `Basic ${authString}`,
					Accept: 'application/json',
				}
			});
			if (response.status != 200) {
				new Notice("Error fetching hackerone api");

			}
			if (response.json.data.length == 0) {
				return earnings
			}
			earnings = earnings.concat(response.json.data)
		}
		return earnings
	}
}

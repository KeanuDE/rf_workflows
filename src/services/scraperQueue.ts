import {crawlWebsite, crawlWebsiteLightweight} from "./crawler";
import type {CrawlerInput, CrawlerOutput} from "../types";

interface QueueItem {
	payload: CrawlerInput;
	lightweight: boolean;
	resolve: (value: CrawlerOutput) => void;
	reject: (error: Error) => void;
}

class ScraperQueue {
	private static instance: ScraperQueue;
	private readonly MAX_CONCURRENCY: number;
	private running = 0;
	private queue: QueueItem[] = [];
	private activeUrls = new Set<string>();
	constructor() {
		this.MAX_CONCURRENCY = process.env.SCRAPER_CONCURRENCY ? parseInt(process.env.SCRAPER_CONCURRENCY) : 4;
	}

	static getInstance(): ScraperQueue {
		if (!ScraperQueue.instance) {
			ScraperQueue.instance = new ScraperQueue();
		}
		return ScraperQueue.instance;
	}

	async enqueue(payload: CrawlerInput, lightweight = false): Promise<CrawlerOutput> {
		const concurrencyKey = `${payload.url}_${lightweight}`;

		// Deduplication Check - wenn diese URL bereits aktiv ist, warten
		if (this.activeUrls.has(concurrencyKey)) {
			console.log(`[ScraperQueue] URL already in progress, queuing: ${payload.url}`);
		} else {
			this.activeUrls.add(concurrencyKey);
		}

		// Wenn noch Slots frei, direkt ausführen
		if (this.running < this.MAX_CONCURRENCY) {
			this.running++;
			console.log(`[ScraperQueue] Starting immediately: ${payload.url} (running: ${this.running}/${this.MAX_CONCURRENCY})`);
			return this.execute(payload, lightweight).finally(() => {
				this.finish(payload, lightweight);
			});
		}

		// Ansonsten queueen und auf freien Slot warten
		return new Promise<CrawlerOutput>((resolve, reject) => {
			console.log(`[ScraperQueue] Queueing: ${payload.url} (queue size: ${this.queue.length})`);
			this.queue.push({payload, lightweight, resolve, reject});
		});
	}

	private async execute(payload: CrawlerInput, lightweight: boolean): Promise<CrawlerOutput> {
		try {
			return lightweight ? await crawlWebsiteLightweight(payload) : await crawlWebsite(payload);
		} catch (error) {
			console.error(`[ScraperQueue] Error scraping ${payload.url}:`, error);
			throw error;
		}
	}

	private finish(payload: CrawlerInput, lightweight: boolean): void {
		this.running--;
		const concurrencyKey = `${payload.url}_${lightweight}`;
		this.activeUrls.delete(concurrencyKey);
		console.log(`[ScraperQueue] Finished: ${payload.url} (running: ${this.running}/${this.MAX_CONCURRENCY})`);
		this.processQueue();
	}

	private processQueue(): void {
		// Nächste Items aus Queue starten solange slots frei
		while (this.running < this.MAX_CONCURRENCY && this.queue.length > 0) {
			const item = this.queue.shift();
			if (!item) break;

			this.running++;
			this.activeUrls.add(`${item.payload.url}_${item.lightweight}`);
			console.log(`[ScraperQueue] Starting from queue: ${item.payload.url} (running: ${this.running}/${this.MAX_CONCURRENCY}, queue: ${this.queue.length})`);

			this.execute(item.payload, item.lightweight)
				.then(item.resolve)
				.catch(item.reject)
				.finally(() => {
					this.finish(item.payload, item.lightweight);
				});
		}
	}

	getStats(): {running: number; queued: number; maxConcurrency: number} {
		return {
			running: this.running,
			queued: this.queue.length,
			maxConcurrency: this.MAX_CONCURRENCY,
		};
	}
}

export const scraperQueue = ScraperQueue.getInstance();
import prettyBytes from "pretty-bytes";
import { Table } from "console-table-printer";
import { parseArgs } from "util";
import { cpus } from "node:os";
import type { ICmd } from "@al/cmd/utils/cmd-runner";
import { type ITask, type IResult } from "./worker";
import WorkerPool from "@al/cmd/utils/worker-pool";
import fileHelper from "@al/cmd/utils/file-helper";
import type {
  GroupedMsg,
  Summary as SummaryData,
  SummaryMap,
} from "@al/models/logData";
import LogData from "@al/models/logData";

let workerURL = new URL("worker.ts", import.meta.url);

interface IStats extends Omit<IResult, "filePath"> {
  minTimeFile: string;
  maxTimeFile: string;
}

class Summary implements ICmd {
  private stats: IStats = {
    maxTime: "0",
    maxTimeFile: "",
    minTime: "z",
    minTimeFile: "",
    size: 0,
    dataMap: {
      httpCodes: new Map<string, GroupedMsg>(),
      jobs: new Map<string, GroupedMsg>(),
      msgs: new Map<string, GroupedMsg>(),
      plugins: new Map<string, GroupedMsg>(),
    },
  };

  private flags = {
    inFolderPath: "",
  };

  private filePaths: string[] = [];

  help(): void {
    console.log(`
    Summary provides a summary view of all the log files.
    
    Usage:
    
    bun run ./cli/main.js --summary [arguments]
  
    The arguments are:
      
      --inFolderPath(-i)      Specifies the path to the folder containing the log files. 
                              The folder should only contain log files or nested folders with log files.
  
    Example: 
      
      bun run ./cli/main.js -s -i "/path/to/logs/folder"
    `);
  }

  async run(): Promise<void> {
    const workerFile = Bun.file(workerURL);
    if (!(await workerFile.exists())) {
      // Path for the bundled code
      workerURL = new URL("summary/worker.js", import.meta.url);
    }

    this.parseFlags();

    await this.processLogs();
  }

  private parseFlags() {
    const { values } = parseArgs({
      args: Bun.argv,
      options: {
        summary: {
          type: "boolean",
          short: "s",
        },
        inFolderPath: {
          type: "string",
          short: "i",
        },
      },
      strict: true,
      allowPositionals: true,
    });

    if (!values.inFolderPath) throw new Error("Pass input logs folder path.");

    this.flags.inFolderPath = values.inFolderPath;
  }

  private async processLogs() {
    this.filePaths = await fileHelper.getFilesRecursively(
      this.flags.inFolderPath
    );

    console.log("=========Begin Read Files=========");
    await this.readFiles();
    console.log("=========End Read Files=========");

    const summary = LogData.initSummary(this.stats.dataMap);

    this.writeContent(summary);
  }

  private readFiles() {
    return new Promise<void>((res, rej) => {
      const maxWorkers = Math.min(
        Math.max(cpus().length - 1, 1),
        this.filePaths.length
      );

      const pool = new WorkerPool<ITask, IResult>(workerURL, maxWorkers);

      let finishedTasks = 0;
      for (const filePath of this.filePaths) {
        pool.runTask({ filePath }, async (err, result) => {
          if (err) {
            console.error("Failed for file: ", filePath);
            rej();
          }

          await this.processFileResponse(result);

          if (++finishedTasks === this.filePaths.length) {
            await pool.close();
            res();
          }
        });
      }
    });
  }

  private async processFileResponse(fileStats: IResult) {
    if (fileStats.maxTime > this.stats.maxTime) {
      this.stats.maxTime = fileStats.maxTime;
      this.stats.maxTimeFile = fileStats.filePath;
    }

    if (fileStats.minTime < this.stats.minTime) {
      this.stats.minTime = fileStats.minTime;
      this.stats.minTimeFile = fileStats.filePath;
    }

    this.stats.size += fileStats.size;

    this.initSummaryMap(fileStats.dataMap);
  }

  private initSummaryMap(dataMap: SummaryMap) {
    Summary.mergeIntoOverallMap(
      dataMap.httpCodes,
      this.stats.dataMap.httpCodes
    );
    Summary.mergeIntoOverallMap(dataMap.jobs, this.stats.dataMap.jobs);
    Summary.mergeIntoOverallMap(dataMap.msgs, this.stats.dataMap.msgs);
    Summary.mergeIntoOverallMap(dataMap.plugins, this.stats.dataMap.plugins);
  }

  private static mergeIntoOverallMap(
    fileMap: Map<string, GroupedMsg>,
    overallMap: Map<string, GroupedMsg>
  ) {
    for (const [k, v] of fileMap) {
      if (!overallMap.has(k)) {
        overallMap.set(k, {
          msg: v.msg,
          hasErrors: false,
          logs: [],
          logsCount: 0,
        });
      }

      const grpOverall = overallMap.get(k)!;
      grpOverall.hasErrors = grpOverall.hasErrors || v.hasErrors;
      grpOverall.logsCount += v.logsCount!;
    }
  }

  private writeContent(summary: SummaryData) {
    console.log();

    this.stats.size = prettyBytes(this.stats.size) as any;

    let table = new Table({
      title: "Overall summary of all the logs",
      columns: [
        { name: "minTime" },
        { name: "minTimeFile" },
        { name: "maxTime" },
        { name: "maxTimeFile" },
        { name: "totalUniqueLogs" },
        { name: "size" },
      ],
      disabledColumns: ["dataMap"],
    });
    table.addRow(
      {
        ...this.stats,
        totalUniqueLogs: summary.msgs.length,
      },
      { color: "green" }
    );
    table.printTable();

    Summary.writeGroupedMsgs(summary.msgs, "Top Logs");
    Summary.writeGroupedMsgs(summary.httpCodes, "HTTP Codes");
    Summary.writeGroupedMsgs(summary.jobs, "Jobs");
    Summary.writeGroupedMsgs(summary.plugins, "Plugins");
  }

  private static writeGroupedMsgs(grpMsgs: GroupedMsg[], title: string) {
    console.log();

    const table = new Table({
      columns: [
        { name: "msg", title: title, alignment: "left" },
        { name: "logsCount", title: "Count" },
      ],
      disabledColumns: ["hasErrors", "logs"],
    });

    for (const grp of grpMsgs.slice(0, 30)) {
      table.addRow(grp, { color: grp.hasErrors ? "red" : "green" });
    }

    table.printTable();
  }
}

export default Summary;

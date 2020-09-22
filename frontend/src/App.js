import React from 'react';
import logo from './logo.png';
import './App.css';

import NodeDetails from './NodeDetails';
import NodeOverview from './NodeOverview';
import UserPiePlot from './UserPiePlot';
import TimeMachine from './TimeMachine';
import Queue from './Queue';
import Backfill from './Backfill';

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      address: 'https://supercomputing.swin.edu.au/monitor/api/',
      apiData: null,
      gotData: false,
      username: null,
      nodeName: null,
      job: null,
      warnings: null,
      snapshotTime: new Date(0),
      lastFetchAttempt: new Date(0),
      holdSnap: false,
      history: null,
      historyData: [],
      historyDataWindow: 600, // seconds
      historyDataCountInitial: 30,
      future: false,
      backfill: null,
      cpuKeys: {
        user: 0, nice: 1, system: 2, wait: 3, idle: 4,
      },
      gpuLayout: null,
    };

    this.fetchHistory();
    this.fetchLatest();
    this.fetchBackfill();
  }

  initHistoryData(nVal) {
    const {
      history,
      snapshotTime,
      historyDataWindow,
      address,
    } = this.state

    if (!(history === null)) {
      const observerNow = snapshotTime / 1000;

      // Get the times to request
      const times = Object.keys(history);
      const historyDataTimes = [];
      for (const time of times) {
        const timeDiff = observerNow - time;
        if ((timeDiff < historyDataWindow) && (timeDiff > 0)) {
          historyDataTimes.push(time);
        }
      }

      // Calculate the data coarseness
      let requestDataTimes = [];
      if ((nVal > 0) && (nVal < historyDataTimes.length)) {
        const nSkip = Math.floor(historyDataTimes.length / nVal);
        for (let i = 0; i < historyDataTimes.length; i += nSkip) {
          requestDataTimes.push(historyDataTimes[i]);
        }
      } else {
        requestDataTimes = historyDataTimes;
      }

      // Make requests, then push to list
      const historyDataTemp = [];
      for (const time of requestDataTimes) {
        const xhr = new XMLHttpRequest();
        // eslint-disable-next-line
                xhr.onreadystatechange = () => {
          if (xhr.readyState === 4 && xhr.status === 200) {
            const jsonData = JSON.parse(xhr.responseText);
            historyDataTemp.push(jsonData);
            if (historyDataTemp.length === requestDataTimes.length) {
              if (nVal > historyDataTimes.length) {
                this.setState({ historyData: historyDataTemp });
              } else if (nVal < 200) {
                this.setState({
                  historyData: historyDataTemp,
                }, () => this.initHistoryData(nVal * 3));
              }
            }
          }
        };
        xhr.open('GET', `${address}bobdata.py?time=${time.toString()}`, true);
        xhr.send();
      }
    }
  }

  updateHistoryData() {
    const {
      historyData,
      snapshotTime,
      historyDataWindow,
      apiData,
    } = this.state

    if (historyData.length < 3) {
      this.historyTimeJump();
    } else {
      const observerNow = snapshotTime / 1000;

      const newHistoryData = [];
      const times = [];
      for (const data of historyData) {
        const timeDiff = observerNow - data.timestamp;
        if ((timeDiff < historyDataWindow) && (timeDiff > 0)) {
          newHistoryData.push(data);
          times.push(data.timestamp);
        }
      }

      // Add newest snapshot
      if (!(times.includes(apiData.timestamp)) && !(apiData === null)) {
        newHistoryData.push(apiData);
      }

      // Update, before putting past values in (if history is too short)
      this.setState({ historyData: newHistoryData });
    }
  }

  historyTimeJump() {
    const { historyDataCountInitial } = this.state
    this.setState({ historyData: [] },
      () => this.initHistoryData(historyDataCountInitial));
  }

  fetchHistory() {
    const { address } = this.state
    const xhr = new XMLHttpRequest();
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4 && xhr.status === 200) {
        const jsonData = JSON.parse(xhr.responseText);
        this.setState({ history: jsonData.history });
        setTimeout(() => { this.fetchHistory(); }, 100000); // 100 seconds
      }
    };
    xhr.open('GET', `${address}bobhistory.py`, true);
    xhr.send();
  }

  fetchLatest() {
    const { holdSnap, address } = this.state
    // Only update if the user doesn't want to hold onto a snap
    if (!(holdSnap)) {
      const xhr = new XMLHttpRequest();
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4 && xhr.status === 200) {
          const jsonData = JSON.parse(xhr.responseText);
          this.cleanState(jsonData);
          this.setState({
            apiData: jsonData,
            gpuLayout: this.extractGpuLayout(jsonData),
            snapshotTime: new Date(jsonData.timestamp * 1000),
            lastFetchAttempt: new Date(),
            gotData: true,
          }, () => this.updateHistoryData());
          setTimeout(() => { this.fetchLatest(); }, 10000); // 10 seconds
        }
      };
      xhr.open('GET', `${address}bobdata.py`, true);
      xhr.send();
    }
  }

  fetchBackfill() {
    const { address } = this.state
    const xhr = new XMLHttpRequest();
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4 && xhr.status === 200) {
        const jsonData = JSON.parse(xhr.responseText);
        this.setState({ backfill: jsonData });
        setTimeout(() => { this.fetchBackfill(); }, 100000); // 100 seconds
      }
    };
    xhr.open('GET', `${address}bobbackfill.py`, true);
    xhr.send();
  }

  fetchTime(time) {
    const { address } = this.state
    this.setState({ holdSnap: true });
    const xhr = new XMLHttpRequest();
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4 && xhr.status === 200) {
        const jsonData = JSON.parse(xhr.responseText);
        this.cleanState(jsonData);
        this.setState({
          apiData: jsonData,
          snapshotTime: new Date(jsonData.timestamp * 1000),
          gotData: true,
        }, () => this.historyTimeJump());
      }
    };
    xhr.open('GET', `${address}bobdata.py?time=${time.toString()}`, true);
    xhr.send();
  }

  cleanState(newData) {
    const {
      job,
      nodeName,
      username,
    } = this.state
    // If a job is gone
    if (!(newData.jobs.hasOwnProperty(job))) {
      this.setState({ job: null });
    }

    // If a node is gone (unlikely)
    if (!(newData.nodes.hasOwnProperty(nodeName))) {
      this.setState({ nodeName: null });
    }

    // If a user is gone
    let hasUser = false;
    for (const jobId in newData.jobs) {
      if (newData.jobs[jobId].username === username) {
        hasUser = true;
        break;
      }
    }
    if (!(hasUser)) this.setState({ nodeName: null });
  }

  selectNode(node) {
    this.setState({ nodeName: node });
  }

  extractGpuLayout(data) {
    // The GPU mapping always needs to be the current one,
    // because it may not have been properly determined in the past
    const layout = {};
    for (const jid in data.jobs) {
      if (data.jobs[jid].nGpus > 0) {
        layout[jid] = {};
        for (const host in data.jobs[jid].gpuLayout) {
          layout[jid][host] = data.jobs[jid].gpuLayout[host];
        }
      }
    }
    return layout;
  }

  getNodeOverview(warnings, warnedUsers) {
    const {
      apiData,
      username,
      job,
      historyData,
      cpuKeys,
     } = this.state
    const { jobs } = apiData;

    const nodeHasJob = {};
    // For each job
    for (const jobId in jobs) {
      // If job is running
      if (jobs[jobId].state === 'RUNNING') {
        // For each host that the job is running on
        for (const host in jobs[jobId].layout) {
          // Add this job to the node
          if (!(nodeHasJob.hasOwnProperty(host))) {
            nodeHasJob[host] = {};
          }
          nodeHasJob[host][jobId] = jobs[jobId];
        }
      }
    }
    return (
      <NodeOverview
        username={username}
        jobId={job}
        nodeData={apiData.nodes}
        jobs={apiData.jobs}
        nodeHasJob={nodeHasJob}
        onRowClick={(node) => this.selectNode(node)}
        warnings={warnings}
        warnedUsers={warnedUsers}
        onJobClick={(jobId) => this.selectJob(jobId)}
        historyData={historyData}
        cpuKeys={cpuKeys}
        getJobUsage={(jid, job, nodes) => this.getJobUsage(jid, job, nodes)}
        getNodeUsage={(jid, job, node, host) => this.getNodeUsage(jid, job, node, host)}
        getTotalUsage={(totalC) => this.getTotalUsage(totalC)}
      />
    );
  }

  selectJob(jobId) {
    // Unselect job if it is already selected
    const { job } = this.state;
    if (job === jobId) {
      this.setState({ job: null });
      this.selectNode(null);
    } else {
      this.setState({ job: jobId },
        () => this.setUserToJob());
    }
  }

  setUserToJob() {
    const { username, apiData, job } = this.state;
    // Set the username to the currently selected job
    const jobUsername = apiData.jobs[job].username;
    if (username !== jobUsername) {
      this.updateUsername(jobUsername);
    }
  }

  getNodeDetails(warnings) {
    const {
      nodeName,
      apiData,
      username,
      job,
      historyData,
      cpuKeys,
      historyDataWindow,
    } = this.state
    return (
      <NodeDetails
        name={nodeName}
        node={nodeName === null ? null : apiData.nodes[nodeName]}
        jobs={apiData.jobs}
        username={username}
        selectedJobId={job}
        onJobClick={(jobId) => this.selectJob(jobId)}
        warnings={warnings}
        historyData={historyData}
        cpuKeys={cpuKeys}
        changeTimeWindow={(t) => this.changeTimeWindow(t)}
        timeWindow={historyDataWindow}
        getNodeUsage={(jid, job, node, host) => this.getNodeUsage(jid, job, node, host)}
      />
    );
  }

  changeTimeWindow(t) {
    const { historyDataCountInitial } = this.state
    this.setState({ historyDataWindow: t },
      () => this.initHistoryData(historyDataCountInitial));
  }

  getSystemUsage() {
    const { apiData } = this.state

    const usage = {
      availCores: 0,
      runningCores: 0,
      availNodes: 0,
      runningNodes: 0,
      freeCores: {},
    };

    const nodeFreeCores = {};

    const { nodes } = apiData;
    for (const host in nodes) {
      if (nodes[host].isCounted) {
        // Available cores
        usage.availCores += nodes[host].nCpus;

        // Available nodes
        usage.availNodes += 1;

        // Node specific free cores
        nodeFreeCores[host] = nodes[host].nCpus;
      }
    }

    const { jobs } = apiData;
    const runningNodeList = [];
    for (const jobId in jobs) {
      if (jobs[jobId].state === 'RUNNING') {
        // Running cores
        usage.runningCores += jobs[jobId].nCpus;
        // Running nodes
        for (const host in jobs[jobId].layout) {
          if (!(runningNodeList.includes(host))) {
            runningNodeList.push(host);
          }
          if (nodeFreeCores.hasOwnProperty(host)) {
            nodeFreeCores[host] -= jobs[jobId].layout[host].length;
          }
        }
      }
    }

    // if a "bonus" node us being wholy or partially used then count it as avail
    for (const host of runningNodeList) {
      if (!(nodes[host].isCounted)) {
        usage.availCores += nodes[host].nCpus;
        usage.availNodes += 1;
      }
    }

    for (const host in nodeFreeCores) {
      const count = nodeFreeCores[host];
      if (!(usage.freeCores.hasOwnProperty(count))) {
        usage.freeCores[count] = 1;
      } else {
        usage.freeCores[count] += 1;
      }
    }

    usage.runningNodes = runningNodeList.length;

    return usage;
  }

  updateUsername(name) {
    const { job, apiData } = this.state;
    // If this new user owns the job, then a cohab job was selected
    // Don't clear
    let clearJob = true;
    if (job !== null) {
      if (apiData.jobs[job].username === name) {
        clearJob = false;
      }
    }

    if (clearJob) {
      this.setState({ username: name, nodeName: null, job: null });
    } else {
      this.setState({ username: name });
    }
  }

  getWarnedUsers(warnings) {
    const { apiData } = this.state
    const warnedUsers = [];
    const { jobs } = apiData;
    for (const nodeName in warnings) {
      over_jobs:
      for (const jobId in warnings[nodeName].jobs) {
        if (jobs.hasOwnProperty(jobId)) {
          const { username } = jobs[jobId];
          if (warnedUsers.includes(username)) continue; // over_jobs

          // Node type warnings
          for (const warning in warnings[nodeName].node) {
            if (!(warnedUsers.includes(username))) {
              if (warnings[nodeName].node[warning]) {
                warnedUsers.push(username);
                continue over_jobs;
              }
            }
          }

          // Job type warnings
          for (const warning in warnings[nodeName].jobs[jobId]) {
            if (warnings[nodeName].jobs[jobId][warning]) {
              if (!(warnedUsers.includes(username))) {
                warnedUsers.push(username);
                continue over_jobs;
              }
            }
          }
        }
      }
    }
    return warnedUsers;
  }

  getUserBadness(scoreSums, users) {
    const { apiData } = this.state
    const badness = {};
    const { jobs } = apiData;

    // Start each user at 0
    for (const username of users) {
      badness[username] = 0;
    }

    for (const nodeName in scoreSums) {
      // For job type warnings
      for (const jobId in scoreSums[nodeName].jobs) {
        if (jobs.hasOwnProperty(jobId)) {
          const { username } = jobs[jobId];

          // Job type warnings
          for (const warning in scoreSums[nodeName].jobs[jobId]) {
            badness[username] += scoreSums[nodeName].jobs[jobId][warning];
          }
        }
      }

      // For node type warnings
      for (const warning in scoreSums[nodeName].node) {
        // Find each job
        for (const jobId in scoreSums[nodeName].jobs) {
          if (jobs.hasOwnProperty(jobId)) {
            const { username } = jobs[jobId];
            badness[username] += scoreSums[nodeName].node[warning];
          }
        }
      }
    }
    return badness;
  }

  // Get the per job usage
  getJobUsage(jid, job, nodes) {
    const usage = {
      cpu: {
        user: 0, system: 0, wait: 0, idle: 0,
      },
      mem: { used: 0, max: 0, total: 0 },
      infiniband: { bytes_in: 0, bytes_out: 0 },
      lustre: { read: 0, write: 0 },
      gpu: { total: 0 },
    };

    let nCpus = 0;

    for (const host in job.layout) {
      if (host in nodes) {
        const nodeUsage = this.getNodeUsage(jid, job, nodes[host], host);
        const nCores = job.layout[host].length;
        usage.cpu.user += nodeUsage.cpu.user * nCores;
        usage.cpu.system += nodeUsage.cpu.system * nCores;
        usage.cpu.wait += nodeUsage.cpu.wait * nCores;
        usage.cpu.idle += nodeUsage.cpu.idle * nCores;
        usage.mem.used += job.mem[host];
        usage.mem.total += nodeUsage.mem.total;
        usage.infiniband.bytes_in += nodeUsage.infiniband.bytes_in;
        usage.infiniband.bytes_out += nodeUsage.infiniband.bytes_out;
        usage.lustre.read += nodeUsage.lustre.read;
        usage.lustre.write += nodeUsage.lustre.write;
        if (job.nGpus > 0) {
          usage.gpu.total += nodeUsage.gpu.total;
        }

        // Count number of CPUs (job.nCpus gives the total amount, not the subset)
        nCpus += job.layout[host].length;
      }
    }

    usage.mem.max = job.memMax;

    usage.cpu.user /= nCpus;
    usage.cpu.system /= nCpus;
    usage.cpu.wait /= nCpus;
    usage.cpu.idle /= nCpus;
    usage.gpu.total /= Object.keys(job.layout).length;

    return usage;
  }

  // Get the per job usage for a specific node
  getNodeUsage(jid, job, node, host) {
    const {
      cpuKeys,
      gpuLayout,
    } = this.state
    const usage = {
      cpu: {
        user: 0, system: 0, wait: 0, idle: 0,
      },
      mem: { used: 0, total: 0 },
      infiniband: { bytes_in: 0, bytes_out: 0 },
      lustre: { read: 0, write: 0 },
      gpu: { total: 0 },
    };

    if (job.layout.hasOwnProperty(host)) {
      const layout = job.layout[host];
      for (const i of layout) {
        usage.cpu.user += node.cpu.coreC[i][cpuKeys.user] + node.cpu.coreC[i][cpuKeys.nice];
        usage.cpu.system += node.cpu.coreC[i][cpuKeys.system];
        usage.cpu.wait += node.cpu.coreC[i][cpuKeys.wait];
        usage.cpu.idle += node.cpu.coreC[i][cpuKeys.idle];
      }
      let nGpus = 0;
      // If thif is a GPU job
      if (job.nGpus > 0) {
        // Zero if unknown
        usage.gpu.total = 0;

        // If the GPU mapping is known
        if (gpuLayout.hasOwnProperty(jid)) {
          if (gpuLayout[jid].hasOwnProperty(host)) {
            if (gpuLayout[jid][host].length > 0) {
              usage.gpu.total = 0;
              nGpus = 0;
              for (const i in gpuLayout[jid][host]) {
                usage.gpu.total += node.gpus['gpu'.concat(i.toString())];
                nGpus++;
              }
            }
          }
        }
      } else {
        usage.gpu.total = 0;
      }
      usage.mem.used = job.mem[host];
      usage.mem.max = job.memMax;
      usage.mem.total = node.mem.total;
      if (node.infiniband !== null) {
        usage.infiniband.bytes_in = node.infiniband.bytes_in;
        usage.infiniband.bytes_out = node.infiniband.bytes_out;
      } else {
        usage.infiniband.bytes_in = 0.0;
        usage.infiniband.bytes_out = 0.0;
      }

      usage.lustre.read = node.lustre.read;
      usage.lustre.write = node.lustre.write;

      const nCores = layout.length;
      usage.cpu.user /= nCores;
      usage.cpu.system /= nCores;
      usage.cpu.wait /= nCores;
      usage.cpu.idle /= nCores;
      usage.gpu.total /= nGpus;
    }

    return usage;
  }

  getTotalUsage(totalC) {
    const { cpuKeys } = this.state
    const total = {};
    for (const key in cpuKeys) {
      total[key] = totalC[cpuKeys[key]];
    }
    return total;
  }

  getUserPiePlot(warnings, warnedUsers, systemUsage) {
    const { apiData } = this.state
    let runningData = {};

    // Sum usage
    for (const jobId in apiData.jobs) {
      const job = apiData.jobs[jobId];
      const { username } = job;
      if (job.state === 'RUNNING') {
        if (!(runningData.hasOwnProperty(username))) {
          runningData[username] = {
            cpus: 0,
            jobs: 0,
          };
        }
        runningData[username].cpus += job.nCpus;
        runningData[username].jobs++;
      }
    }

    const usernames = Object.keys(runningData);

    // Get usage percentage
    for (const username of usernames) {
      runningData[username].percent = 100 * runningData[username].cpus / systemUsage.availCores.toFixed(0);
    }

    // Convert to array
    const usageDataArray = [];
    for (const username in runningData) {
      usageDataArray.push({
        username,
        cpus: runningData[username].cpus,
        jobs: runningData[username].jobs,
      });
    }
    runningData = usageDataArray;

    // Sort by usage
    runningData.sort((a, b) => a.cpus - b.cpus);
    for (let i = 0; i < runningData.length; i++) {
      runningData[i].index = i;
    }

    return (
      <UserPiePlot
        runningData={runningData}
        runningCores={systemUsage.runningCores}
        availCores={systemUsage.availCores}
        updateUsername={(name) => this.updateUsername(name)}
        warnedUsers={warnedUsers}
        badness={this.getUserBadness(warnings, usernames)}
      />
    );
  }

  getQueue() {
    const { apiData } = this.state
    // Sum usage
    let queueData = {};
    const queueTotal = { size: 0, cpuHours: 0 };

    for (const jobId in apiData.jobs) {
      const job = apiData.jobs[jobId];
      const { username } = job;
      if (job.state === 'PENDING') {
        queueTotal.size++;

        // Time limit is given in minutes
        queueTotal.cpuHours += job.timeLimit * job.nCpus / 60;

        if (!(queueData.hasOwnProperty(username))) {
          queueData[username] = {
            jobs: 0,
            hours: 0,
          };
        }
        queueData[username].hours += job.nCpus * job.timeLimit / 60;
        queueData[username].jobs++;
      }
    }

    const queueDataArray = [];
    for (const username in queueData) {
      queueDataArray.push({
        username,
        jobs: queueData[username].jobs,
        hours: queueData[username].hours,
      });
    }
    queueData = queueDataArray;

    return (
      <Queue
        queueData={queueData}
        queueTotal={queueTotal}
        availCores={this.getSystemUsage().availCores}
      />
    );
  }

  getBackfill() {
    const { backfill } = this.state
    return (
      <Backfill
        backfillData={backfill}
      />
    );
  }

  show() {
    const {
      future,
      gotData,
      lastFetchAttempt,
      snapshotTime,
      holdSnap,
    } = this.state
    if (!future) {
      if (gotData) {
        // If haven't fetched for a long time, then force a fetch
        // Usually happens when computer is waking from sleep
        const now = new Date();
        const fetchAge = (now - lastFetchAttempt) / 1000;
        const snapAge = (now - snapshotTime) / 1000;
        if (fetchAge > 300) {
          this.fetchLatest();
          // If the backend copy is old, then maintenance is occuring
        } else if ((snapAge > 600) && !(holdSnap)) {
          return (
            <div id="main-box">
              The job monitor is currently down for maintenance and will be back soon.
              {' '}
              <br />
              Jobs will continue running and can still be inspected by logging in to the compute nodes directly.
            </div>
          );
        } else {
          const warnings = this.generateWarnings();
          const warnedUsers = this.getWarnedUsers(warnings);
          const systemUsage = this.getSystemUsage();
          if (systemUsage.runningCores === 0) {
            return (
              <div id="main-box">
                OzSTAR is currently down for maintenance and will be back soon.
                {' '}
                <br />
              </div>
            );
          }
          return (
            <div id="main-box">
              {this.getUserPiePlot(warnings, warnedUsers, systemUsage)}
              {this.getNodeOverview(warnings, warnedUsers)}
              {this.getNodeDetails(warnings)}
            </div>
          );
        }
      }
    } else {
      return (
        <div id="main-box">
          {this.getQueue()}
          {this.getBackfill()}
        </div>
      );
    }
  }

  instantWarnings(data) {
    const warnSwap = 20; // If swap greater than
    const warnWait = 5; // If waiting more than
    const warnUtil = 80; // If CPU utilisation below
    const warnMem = 70; // If memory used is less than
    const baseMem = 2048; // Megabytes of "free" memory per core not to warn for
    const baseMemSingle = 4096; // Megabytes of memory for the first core
    const graceTime = 5; // (Minutes) give jobs some time to get setup

    const { cpuKeys } = this.state

    const warnings = {};

    for (const nodeName in data.nodes) {
      const node = data.nodes[nodeName];

      // Default scores to zero
      warnings[nodeName] = { node: { swapUse: 0 }, jobs: { cpuUtil: 0, cpuWait: 0, memUtil: 0 } };

      // Score = percentage of swap used
      if (100 * ((node.swap.total - node.swap.free) / node.swap.total) > warnSwap) {
        warnings[nodeName].node.swapUse = 100 * ((node.swap.total - node.swap.free) / node.swap.total);
      }
    }

    for (const jobId in data.jobs) {
      const job = data.jobs[jobId];
      if (job.state === 'RUNNING' && job.runTime > graceTime) {
        for (const nodeName in job.layout) {
          const node = data.nodes[nodeName];
          warnings[nodeName].jobs[jobId] = {};

          // CPU use
          let cpuUsage = 0;
          let cpuWait = 0;
          for (const i of job.layout[nodeName]) {
            cpuUsage += node.cpu.coreC[i][cpuKeys.user] + node.cpu.coreC[i][cpuKeys.system] + node.cpu.coreC[i][cpuKeys.nice];
            cpuWait += node.cpu.totalC[cpuKeys.wait];
          }

          // cpuUsage /= job.layout[nodeName].length;
          // cpuWait /= job.layout[nodeName].length;

          // If below utilisation                               AND (not a GPU job                  OR uses more than 1 core)
          if (cpuUsage / job.layout[nodeName].length < warnUtil && (job.layout[nodeName].length > 1 || job.Gpu === 0)) {
            // Score = percentage wasted * number of cores
            warnings[nodeName].jobs[jobId].cpuUtil = (job.layout[nodeName].length * warnUtil) - cpuUsage;
          }

          if (cpuWait / job.layout[nodeName].length > warnWait) {
            // Score = percentage waiting * number of cores
            warnings[nodeName].jobs[jobId].cpuWait = cpuWait - warnWait;
          }
        }

        // CPUs per node
        const nCpus = job.nCpus / Object.keys(job.layout).length;

        // Memory that jobs can get for free
        const freeMem = baseMem * (nCpus - 1.0) + baseMemSingle;

        // Factor for making it stricter for large requests
        const x = Math.max(0.0, (job.memReq - freeMem) / job.memReq);

        const criteria = (job.memReq - freeMem) * (1.0 - x) + x * (warnMem / 100.0) * job.memReq;
        if (job.memMax < criteria) {
          // Max is over all nodes - only warn if all nodes are below threshold (quite generous)
          for (const nodeName in job.mem) {
            // Score = GB wasted
            warnings[nodeName].jobs[jobId].memUtil = (criteria - job.memMax) / 1024;
          }
        }
      }
    }
    return warnings;
  }

  generateWarnings() {
    const warningWindow = 600; // Time window to check for warnings
    const warningFraction = 0.5; // If more than this fraction in the window is bad, then trigger warning

    const {
      snapshotTime,
      historyData,
    } = this.state

    // Get the data snapshots that we check for warnings
    const now = snapshotTime / 1000;
    const warningDataIndex = [];
    for (let i = 0; i < historyData.length; i++) {
      const data = historyData[i];
      if (now - data.timestamp < warningWindow) {
        warningDataIndex.push(i);
      }
    }

    // Threshold number of snapshots for triggering warning
    const threshold = Math.floor(warningFraction * warningDataIndex.length);

    // Collate all the instantaneous warnings
    const warningSums = {};
    const scoreSums = {};

    // i is the index of the data
    for (const i of warningDataIndex) {
      const data = historyData[i];
      const warnings = this.instantWarnings(data);

      // For each node
      for (const nodeName in warnings) {
        if (!(warningSums.hasOwnProperty(nodeName))) {
          warningSums[nodeName] = { node: {}, jobs: {} };
          scoreSums[nodeName] = { node: {}, jobs: {} };
        }

        // Count node warnings
        for (const warningName in warnings[nodeName].node) {
          if (!(warningSums[nodeName].node.hasOwnProperty(warningName))) {
            warningSums[nodeName].node[warningName] = 0;
            scoreSums[nodeName].node[warningName] = 0;
          }
          if (warnings[nodeName].node[warningName] > 0) {
            warningSums[nodeName].node[warningName]++;
            scoreSums[nodeName].node[warningName] += warnings[nodeName].node[warningName];
          }
        }

        // Count job warnings
        for (const jobId in warnings[nodeName].jobs) {
          if (!(warningSums[nodeName].jobs.hasOwnProperty(jobId))) {
            warningSums[nodeName].jobs[jobId] = {};
            scoreSums[nodeName].jobs[jobId] = {};
          }

          for (const warningName in warnings[nodeName].jobs[jobId]) {
            if (!(warningSums[nodeName].jobs[jobId].hasOwnProperty(warningName))) {
              warningSums[nodeName].jobs[jobId][warningName] = 0;
              scoreSums[nodeName].jobs[jobId][warningName] = 0;
            }
            if (warnings[nodeName].jobs[jobId][warningName] > 0) {
              warningSums[nodeName].jobs[jobId][warningName]++;
              scoreSums[nodeName].jobs[jobId][warningName] += warnings[nodeName].jobs[jobId][warningName];
            }
          }
        }
      }
    }

    // Set jobs below the threshold to score = 0
    for (const nodeName in warningSums) {
      for (const warningName in warningSums[nodeName].node) {
        if (warningSums[nodeName].node[warningName] > threshold) {
          scoreSums[nodeName].node[warningName] = (scoreSums[nodeName].node[warningName] / warningDataIndex.length) | 0;
        } else {
          scoreSums[nodeName].node[warningName] = 0;
        }
      }
      for (const jobId in warningSums[nodeName].jobs) {
        for (const warningName in warningSums[nodeName].jobs[jobId]) {
          if (warningSums[nodeName].jobs[jobId][warningName] > threshold) {
            scoreSums[nodeName].jobs[jobId][warningName] = (scoreSums[nodeName].jobs[jobId][warningName] / warningDataIndex.length) | 0;
          } else {
            scoreSums[nodeName].jobs[jobId][warningName] = 0;
          }
        }
      }
    }

    return scoreSums;
  }

  getTimeMachine() {
    const {
      history,
      snapshotTime,
    } = this.state
    return (
      <TimeMachine
        history={history}
        clickLoadTime={(time) => this.fetchTime(time)}
        snapshotTime={snapshotTime}
        viewPresent={() => this.viewPresent()}
        viewFuture={() => this.viewFuture()}
        viewPast={() => this.viewPast()}
      />
    );
  }

  freeze() {
    this.setState({ holdSnap: true });
  }

  unfreeze() {
    this.setState({ holdSnap: false, snapshotTime: new Date() },
      () => this.fetchLatest());
  }

  viewFuture() {
    this.setState({ future: true });
  }

  viewPresent() {
    this.setState({ future: false });
    this.unfreeze();
  }

  viewPast() {
    this.setState({ future: false });
    this.freeze();
  }

  render() {
    return (
      <div className="App">
        <header className="App-header">
          <div id="header">
            <div id="logo">
              <a href="https://supercomputing.swin.edu.au/">
                <img src={logo} className="App-logo" alt="logo" />
              </a>
            </div>
            <div id="page-title">
              Job Monitor
            </div>
            <div id="header-right" />
          </div>
        </header>
        {this.getTimeMachine()}
        {this.show()}

      </div>
    );
  }
}

export default App;

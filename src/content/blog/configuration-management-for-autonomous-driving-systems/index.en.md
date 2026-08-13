---
title: Configuration Management for Autonomous Driving Systems
description: An investigation into organizing and composing multi-module configurations in autonomous-driving systems, reproducing experiments, and selecting mature solutions for runtime configuration distribution.
---

## Problem and requirements

An autonomous-driving system consists of multiple cooperating modules, each of which must read its corresponding configuration at runtime. These configurations are commonly stored as YAML files. Directly maintaining configuration files is simple and effective while the number of modules is small and operating conditions are relatively fixed. As vehicle platforms, operating modes, test scenarios, and repeatedly tested parameters increase, however, configuration management gradually shifts from reading and writing individual files to organizing a large number of configuration combinations.

Different scenarios and parameter experiments produce many configurations that are similar but not identical. Without explicit mechanisms for composition, overrides, and recording, those differences are easily scattered across duplicated files and temporary edits. It then becomes difficult to answer several basic questions: Which configuration values did a run actually use? Which base configurations and experimental adjustments produced them? Which test conditions and results correspond to them? Can the same experiment be reproduced?

The problem to govern is therefore the complete configuration lifecycle—from organization, composition, and selection to adjustment and runtime records—not merely replacing YAML with another file format, nor simply introducing a remote configuration center. The investigation can accordingly span multiple technical layers. Configuration formats and validation tools, experiment-management systems, configuration centers, and communication infrastructure solve different problems, but each may assume part of the overall responsibility.

The requirements that can currently be stated are:

- Configurations should be clearly organized by module and applicable conditions, with common parts reused across scenarios wherever possible instead of maintaining many repetitive complete configurations.
- Configurations should be composable and automatically selectable according to conditions such as vehicle platform, operating mode, and test scenario. A single experiment should also be able to override parameters under test explicitly without modifying the baseline configuration.
- The complete effective configuration of a run should be inspectable and exportable without manually tracing multiple layers of files and temporary changes.
- The final configuration used by each experiment should be explicitly associated with the corresponding test conditions and results, so that the effects of parameter changes can be compared and experiments can be reproduced.
- Configuration files should remain reasonably easy to read and edit.
- A graphical configuration interface should be available. If the interface fully covers routine inspection and editing, requirements on direct source-file editing can be relaxed appropriately.
- Configuration should support remote distribution and updates, with runtime adjustment for parameters that need to change online.
- Configuration history should make it possible to determine which configuration a module actually used at a particular time.
- Mature tools should cover general-purpose capabilities wherever possible, limiting integration cost and the amount of project-specific code that must be maintained.

## Candidate solutions

The current framework uses ROS/ROS 2 as its communication middleware, and its parameter server can already satisfy part of these requirements. The framework's long-term direction, however, is to progressively remove its coupling to ROS/ROS 2 and ultimately eliminate that dependency. For this reason, the parameter server was not adopted from the outset.

Configuration management is not a core algorithmic capability of the motion-control framework and should not consume excessive development effort. To reduce custom development, the initial investigation included existing configuration platforms such as [Apollo](https://www.apolloconfig.com/#/) and [Nacos](https://nacos.io/en/). They provide relatively complete functionality, but neither fully matches the current project's requirements and intended usage.

The investigation then evaluated three further options in this order:

- [etcd](https://etcd.io/): its capabilities can cover the main requirements, but its integration and operating costs are relatively high, so it was not pursued.
- [NATS](https://nats.io/): both its functionality and ecosystem are mature, and it was once close to becoming the final choice. Before committing, however, it remained necessary to consider whether another infrastructure choice would better suit the long-term evolution of the whole system.
- [Zenoh](https://zenoh.io/): Zenoh is not a ready-made configuration center. Building a configuration system on it would require additional application-layer logic and therefore more development than directly adopting NATS. If Zenoh is later used for other capabilities across the autonomous-driving system, however, configuration functionality could share the same communication infrastructure. On that basis, Zenoh remains a future candidate.

> **Additional context: Zenoh and ROS 2**
>
> Zenoh is also one of the non-DDS RMW implementations for ROS 2. Beginning with Kilted, `rmw_zenoh_cpp` is provided in binary distributions as a supported RMW implementation. See the [official ROS 2 documentation](https://docs.ros.org/en/kilted/Installation/RMW-Implementations/Non-DDS-Implementations/Working-with-Zenoh.html) for usage. A [research report on ROS 2 RMW alternatives](https://discourse.openrobotics.org/uploads/short-url/o9ihvSjCwB8LkzRklpKdeesRTDi.pdf) is also available.

## Moving from YAML to TOML

Influenced by earlier ROS conventions, all existing framework configuration files use YAML. The configuration-system investigation also prompted a fresh comparison between YAML and TOML:

- TOML has a more restrained syntax and data model, so configuration semantics are usually more explicit.
- YAML has a longer history and greater expressive power, while also permitting more complex organizational features such as anchors and aliases.

JSON has a mature serialization, schema-validation, and tooling ecosystem. Whether configuration data can be converted cleanly to and from JSON-compatible structures is therefore a practical consideration in choosing a file format. Compared with YAML, TOML has a more restrained data model. As long as values are restricted to types shared by both formats, conversion between TOML and JSON is generally straightforward. It would be inaccurate to call that conversion universally lossless, because TOML natively supports dates, times, and special floating-point values that have no direct JSON counterpart. When those TOML-specific types are not used, however, stable round-trip conversion between TOML and JSON-compatible structures is possible, allowing the corresponding tool ecosystem to be reused.

YAML's anchors, aliases, and other advanced capabilities were also considered. They can express reuse and composition within configuration files, but the current requirements do not depend on them. The same relationships can be represented more explicitly by application code or dedicated tools, without adding format-level complexity for scenarios that have not yet appeared. TOML therefore better fits this system's present need for a clear data structure and mature tooling. This is a project-specific choice, not a rejection of YAML's general value.

Based on these factors, the future configuration system will use TOML as its base file format.

## Scope of the first implementation stage

Moving fully to a new configuration system is not a simple component replacement. It would simultaneously affect the file format, parsing interfaces, runtime updates, remote distribution, history management, and graphical interfaces. The task boundary would be too broad and would touch a large number of existing modules. Attempting the whole migration at once would leave the system in a prolonged period in which old and new mechanisms coexist and interfaces continue to change, disrupting normal development of other features.

The first stage will therefore migrate the framework's configuration files from YAML to TOML without simultaneously introducing runtime file watching or other configuration-management mechanisms. Although limited in scope, this change has independent long-term value: it establishes the base file format and data representation that subsequent work will retain, and provides a stable starting point for later parsing, validation, and distribution capabilities.

When requirements for remote updates, dynamic tuning, or other functions become concrete, the corresponding interfaces can be added and the system conditions at that time can determine whether to adopt file watching, NATS, Zenoh, or other suitable infrastructure. This avoids prematurely incurring the development cost of a complete configuration system while ensuring that the present format migration is not a temporary change with no future value.

The file format and the complete configuration system are therefore divided into two implementation stages: the former is foundational work that can be determined and completed independently now; the latter will proceed only after its requirements and technical boundaries become clearer.

## Further investigation: configuration composition and experiment management

> This section records conclusions drawn from the current requirements and official documentation for the evaluated tools. The proposed integration has not yet been implemented and validated in the existing autonomous-driving system.

### Recommended solution

For the current scenario, the most suitable starting point is:

**Hydra for configuration composition and parameter experiments; ClearML for experiment recording, comparison, reproduction, and remote execution. Add Nacos as a runtime publication layer only when remote updates during operation become an explicit requirement.**

The complete relationship is:

```text
Module defaults
+ vehicle configuration
+ platform configuration
+ operating mode
+ test scenario
+ experiment parameters
        ↓
Hydra composes and generates a complete configuration snapshot
        ↓
Each module reads the fixed configuration for this run
        ↓
ClearML records the configuration, code version, environment, results, and artifacts
        ↓
When online publication is required, confirmed configurations are delivered through Nacos
```

#### Why Hydra

Hydra is designed precisely for problems where configuration differences span multiple dimensions. Vehicles, platforms, modes, scenarios, and controllers can each be configuration groups. Each experiment records only its selections and differences relative to defaults, without copying a complete YAML document. Hydra's official “configuring experiments” pattern describes this situation and supports sweeps over multiple experiment combinations directly. [Hydra: Configuring Experiments](https://hydra.cc/docs/patterns/configuring_experiments/), [Hydra: Multi-run](https://hydra.cc/docs/tutorials/basic/running_your_app/multi-run/)

Rather than copying many complete files for different scenarios, configuration can be divided into independent dimensions:

- `vehicle`: vehicle dimensions and actuator parameters;
- `platform`: physical vehicle, simulation, or offline playback;
- `mode`: different control or operating modes;
- `scenario`: test scenarios;
- `controller`: controllers and their default parameters;
- `experiment`: the small set of adjustments made by a particular experiment relative to the dimensions above.

Every run must ultimately materialize an immutable snapshot of the fully resolved configuration. Individual modules read only that ordinary configuration; they do not need to know about Hydra and should not independently repeat configuration composition.

#### Why ClearML

Hydra can generate configurations and run batches, but by itself it cannot fully answer:

- Which final configuration produced this result?
- Did the code contain uncommitted changes at the time?
- Which parameters differed?
- How can the outputs and metrics of multiple experiments be compared?
- How can an experiment be cloned, adjusted slightly, and run again?

ClearML officially integrates with Hydra and automatically records the complete OmegaConf configuration and runtime overrides. Its web interface can compare source code, dependencies, configuration objects, parameters, metrics, and plots. It also supports cloning tasks, modifying their configurations, and assigning them to an Agent for remote execution. [ClearML Hydra integration](https://clear.ml/docs/latest/docs/integrations/hydra/), [Comparing experiments](https://clear.ml/docs/latest/docs/webapp/webapp_exp_comparing/), [Reproducing tasks](https://clear.ml/docs/latest/docs/getting_started/reproduce_tasks/)

ClearML also supports self-hosting and offline experiments, so experimental vehicles and development environments do not need to remain continuously online. [Self-hosting ClearML Server](https://clear.ml/docs/latest/docs/deploying_clearml/clearml_server/), [Offline Mode](https://clear.ml/docs/latest/docs/guides/set_offline)

Although ClearML is positioned primarily as an MLOps platform, a Task can represent a test, application, or arbitrary custom execution and is not limited to neural-network training.

### Runtime configuration should be treated separately

When configurations genuinely need to be published remotely to running modules, Nacos is more suitable than building a complete configuration system directly on NATS, Zenoh, or etcd.

Nacos currently provides:

- configuration queries and listeners;
- history and republishing;
- gray releases;
- import, export, and cloning;
- local snapshots and failure recovery.

At the same time, Nacos explicitly stores and distributes configuration content as a whole; it does not understand the semantics of application-specific fields. [Nacos configuration-management overview](https://nacos.io/docs/latest/manual/user/config/overview/), [History, operations, and troubleshooting](https://nacos.io/en/docs/latest/manual/user/config/ops-and-troubleshooting/)

The correct responsibility boundary is therefore:

- Hydra determines how a configuration is composed.
- ClearML records what results that configuration produced in a particular experiment.
- Nacos only publishes a confirmed configuration to running modules.
- The application itself enforces parameter ranges, cross-field constraints, dynamically mutable fields, and safe application points.

The NATS and Zenoh investigations remain useful. Both can provide key-value storage, subscriptions, or persistence, but a complete configuration-management system would still require a graphical interface, publication workflow, schema, audit trail, and rollback capability. Unless one of them has already become the communication infrastructure selected for the whole system, building a configuration system from scratch on it is less suitable than adopting Nacos directly.

### Roles of other mature solutions

| Solution                | Suitable when                                                                        | Why it is not the first choice                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| CUE + ClearML           | Configuration spans Python, Rust, and C++, with strong schema requirements           | Introduces a new configuration language; sweeps and ClearML integration are less direct than with Hydra |
| Hydra + DVC Experiments | A Git-native, service-free workflow with data and pipeline versioning is preferred   | The GUI, task cloning, and remote execution are less complete than ClearML                              |
| Dynaconf                | Only layered TOML/YAML configuration, overrides, and validation in Python are needed | Does not manage sweeps, experiment results, or complete reproduction                                    |
| ClearML alone           | Configuration is simple and only recording and remote execution are needed           | Lacks Hydra's clear multidimensional composition model                                                  |
| Nacos alone             | The primary problem is runtime publication and hot updates                           | Does not solve composition of many test configurations or associate them with experiment results        |

CUE remains a worthwhile cross-language alternative. It can directly read, validate, compose, and output TOML, YAML, and JSON without requiring running modules to understand CUE. [Configuration composition with CUE](https://cuelang.org/docs/concept/how-cue-enables-configuration/), [CUE and TOML](https://cuelang.org/docs/concept/how-cue-works-with-toml/)

DVC can also use Hydra to compose configurations and run and save experiments for multi-stage pipelines containing arbitrary commands; it is not limited to a single Python training script. [DVC and Hydra integration](https://dvc.org/blog/dvc-hydra-integration/)

### Corrections to the earlier conclusion

Changing from YAML to TOML can improve readability and the data model, but it does not by itself prevent configuration sprawl. A durable mechanism should instead:

1. compose independent dimensions rather than copy complete scenario configurations;
2. generate and preserve an immutable final configuration snapshot for every run;
3. associate parameters, code, input data, logs, and results under one experiment ID;
4. allow only confirmed configurations to enter the runtime publication layer;
5. keep experiment-history management outside online hot updates.

The highest-value next validation is therefore **Hydra + ClearML**. Custom code should be limited to two thin boundaries: the startup adapter that hands the final configuration to each module, and the small amount of code that records domain-specific metrics and artifacts in ClearML. Configuration composition, batch experiments, the history database, comparison interface, and remote task system should not be developed from scratch.

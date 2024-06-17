# companion-module-uniliga-cg


## Installing the Module
1. Clone the Project to your computer running companion.
2. Open up Companion. On the Top Right of the Client there is a COG. Click it and a new Input "Developer Modules Path" will appear
3. In this Input select the Folder you just cloned.
4. Thats it, the module is now installed!

## Configuration
1. First head to the Companion GUI, search for the Uniliga CG Module in the Connections Tab and add it.
2. In the Target URL Field add `wss://overlays.dev.konopka.gg/wss/overlays/`.
3. In the Project ID Field add your Project's ID. You can find this by going to the Frontend of the Uniliga CG and copying the ID from the Home Tab.


## Usage
The following Features are currently available:
- Set interview bug state (Toggle, Hidden, Visible)
- Set prediction bug state (Toggle, Hidden, Visible)
- Refresh all Standings
- Restart Timer
- Set, add or substract from Timer
- Set current match (Previous, Next)
- Swap team sides in current match
- Set, add or substract score from a Team in the current match

In the root of the cloned folder is a example companion Page, that showcases the current Features. 

## Devlopmnet
1. All the Code is located in main.js, you are free to change stuff there
2. Stop companion
3. Build with `yarn companion-module-build --dev`
4. Start companion
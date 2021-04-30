const PluginRepository = require('./plugins/PluginRepository').default;
const SocketService = require('./services/SocketService').default;
const Plugin = require('./plugins/Plugin').default;
const PluginTypes = require('./plugins/PluginTypes');
const { Blockchains } = require('./models/Blockchains');
const Network = require('./models/Network').default;
const WalletInterface = require('./models/WalletInterface').default;
const { WALLET_METHODS } = require('./models/WalletInterface');
const LocalSocket = require("./wallets/LocalSocket").default;
const RelaySocket = require("./wallets/RelaySocket").default;
const LegacyInjection = require("./wallets/LegacyInjection").default;
const Injection = require("./wallets/Injection").default;
const Token = require("./models/Token").default;

let origin;

const EVENTS = {
	Disconnected:'dced',
	LoggedOut:'logout',
};

let socket = null;
let socketSetters = [];
let holderFns = {};

class ScatterJS {

	constructor() {
		this.identity = null;
		this.network = null;

		PluginRepository.loadPlugin(new RelaySocket(this, holderFns));
		PluginRepository.loadPlugin(new LocalSocket(this, holderFns));
		PluginRepository.loadPlugin(new Injection(this, holderFns));
		PluginRepository.loadPlugin(new LegacyInjection(this, holderFns));
	}

	loadPlugin(plugin){
		const noIdFunc = () => { if(!holderFns.get().identity) throw new Error('No Identity') };
		if(!plugin.isValid()) throw new Error(`${plugin.name} doesn't seem to be a valid ScatterJS plugin.`);

		PluginRepository.loadPlugin(plugin);

		if(plugin.type === PluginTypes.BLOCKCHAIN_SUPPORT){
			this[plugin.name] = plugin.signatureProvider(noIdFunc, () => holderFns.get().identity);
			this[plugin.name+'Hook'] = plugin.hookProvider;
			if(typeof plugin.multiHook === 'function') this[plugin.name+'MultiHook'] = plugin.multiHook;
			socketSetters.push(plugin.setSocketService);
		}

		if(plugin.type === PluginTypes.WALLET_SUPPORT){
			plugin.init(this, holderFns, socketSetters);
		}
	}

	async connect(pluginName, options){
		return new Promise(async resolve => {
			if(!options) options = {};
			this.network = options.hasOwnProperty('network') ? options.network : null;

			const wallets = PluginRepository.wallets();

			if(socket) {
				socket.disconnect();
				socket = null;
			}

			let connected = false;
			let promises = [];
			for (let i = 0; i < wallets.length; i++) {
				if(connected) return;
				const wallet = wallets[i];
				promises.push(Promise.race([
					wallet.connect(pluginName, options).then(async socketService => {
						if (socketService) {
							if (socketService !== 'injection') {
								socket = socketService;
								socketSetters.map(x => x(socketService));
							}
							if (typeof wallet.runBeforeInterfacing === 'function') await wallet.runBeforeInterfacing();
							new WalletInterface(wallet.name, wallet.methods(), holderFns.get());
							if (typeof wallet.runAfterInterfacing === 'function') await wallet.runAfterInterfacing();
							WalletInterface.bindBasics(holderFns.get());
							connected = true;
							resolve(true);
						}
					}).catch(() => false),
					new Promise(r => setTimeout(() => r(false), 5000))
				]))
			}

			await Promise.all(promises);
			resolve(false);
		})
	}
}

class Holder {
    constructor(_scatter){
        this.scatter = _scatter;
    }

	plugins(...plugins) {
		if (!this.scatter.isExtension) {
			plugins.map(plugin => this.scatter.loadPlugin(plugin));
		}
	}

	connect(...params){
    	return this.scatter.connect(...params);
	}

	catchAll(...params){

	}
}


let holder = new Proxy(new Holder(new ScatterJS()), {
	get(target,name) {
		if(typeof target[name] !== 'undefined') return target[name];
		return target.scatter[name];
	}
});
holderFns.set = s => holder.scatter = s;
holderFns.get = () => holder.scatter;
if (typeof window !== 'undefined') window.ScatterJS = holder;


holder.Plugin = Plugin;
holder.PluginTypes = PluginTypes;
holder.Blockchains = Blockchains;
holder.Network = Network;
holder.Token = Token;
holder.SocketService = SocketService;
holder.EVENTS = EVENTS;
holder.WalletInterface = WalletInterface;
holder.WALLET_METHODS = WALLET_METHODS;
// export { Plugin, PluginTypes, Blockchains, Network, SocketService, EVENTS, WalletInterface, WALLET_METHODS };
// export default holder;

module.exports = { Plugin, PluginTypes, Blockchains, Network, SocketService, EVENTS, WalletInterface, WALLET_METHODS };
module.exports.default = holder;

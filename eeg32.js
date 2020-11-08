//Joshua Brewster, AGPL (copyleft)

class eeg32 { //Contains structs and necessary functions/API calls to analyze serial data for the FreeEEG32
    constructor() {
		
        //Free EEG 32 data structure:
        /*
            [stop byte, start byte, counter byte, 32x3 channel data bytes (24 bit), 3x2 accelerometer data bytes, stop byte, start byte...] 
            Total = 105 bytes/line
        */
        this.buffer = []; 
        this.startByte = 160; // Start byte value
		this.stopByte = 192; // Stop byte value
		this.searchString = new Uint8Array([this.stopByte,this.startByte]);
		
		this.data = { //Data object to keep our head from exploding. Get current data with e.g. this.data.A0[this.data.counter-1]
			counter: 0,
			ms: [],
			'A0': [],'A1': [],'A2': [],'A3': [],'A4': [],'A5': [],'A6': [],'A7': [], //ADC 0
			'A8': [],'A9': [],'A10': [],'A11': [],'A12': [],'A13': [],'A14': [],'A15': [], //ADC 1
			'A16': [],'A17': [],'A18': [],'A19': [],'A20': [],'A21': [],'A22': [],'A23': [], //ADC 2
			'A24': [],'A25': [],'A26': [],'A27': [],'A28': [],'A29': [],'A30': [],'A31': [], //ADC 3
			'Ax': [], 'Ay': [], 'Az': [], 'Gx': [], 'Gy': [], 'Gz': []  //Peripheral data (accelerometer, gyroscope)
		}

		//navigator.serial utils
		if(!navigator.serial){
			alert("navigator.serial not found! Enable #enable-experimental-web-platform-features in chrome://flags (search 'experimental')")
		}
		this.port = null;

    }
	
    bytesToInt16(x0,x1){
	return x0 * 256 + x1;
    }

    int16ToBytes(y){ //Turns a 24 bit int into a 3 byte sequence
        return [y & 0xFF , (y >> 8) & 0xFF];
    }

    bytesToInt24(x0,x1,x2){ //Turns a 3 byte sequence into a 24 bit int
        return x0 * 65536 + x1 * 256 + x2;
    }

    int24ToBytes(y){ //Turns a 24 bit int into a 3 byte sequence
        return [y & 0xFF , (y >> 8) & 0xFF , (y >> 16) & 0xFF];
    }

    decode(buffer = this.buffer) { //returns true if successful, returns false if not

		var needle = this.searchString
		var haystack = buffer;
		var search = this.boyerMoore(needle);
		var skip = search.byteLength;
		var indices = [];

		for (var i = search(haystack); i !== -1; i = search(haystack, i + skip)) {
			indices.push(i);
		}
		//console.log(indices);

		if(indices.length >= 2){
			var line = buffer.splice(indices[0],indices[1]-indices[0]); //Splice out this line to be decoded

			// line[0] = stop byte, line[1] = start byte, line[2] = counter, line[3:99] = ADC data 32x3 bytes, line[100-104] = Accelerometer data 3x2 bytes
			
			if(indices[1] - indices[0] !== 105) {buffer.splice(0,indices[1]); return false;} //This is not a valid sequence going by size, drop sequence and return
			
			if(indices[0] !== 0){
				buffer.splice(0,indices[0]); // Remove any useless junk on the front of the buffer.		
			}

			//line found, decode.
			this.data.counter++; 
			this.data.ms.push(performance.now());//Might not be accurate to the exact sample timing

			for(var i = 3; i < 99; i+=3) {
				var channel = "A"+(i-3)/3;
				this.data[channel].push(this.bytesToInt24(line[i],line[i+1],line[i+2]));
			}

			this.data["Ax"].push(this.bytesToInt16(line[99],line[100]));
			this.data["Ay"].push(this.bytesToInt16(line[101],line[102]));
			this.data["Az"].push(this.bytesToInt16(line[103],line[104])); 

			return true;
			//Continue
		}
		else {this.buffer = []; return false;} 
	}

	//Callbacks
	onDecoded(){
		//console.log("new data!");
	}

	onConnectedCallback() {
		console.log("port connected!");
	}

	onReceive(value){
		this.buffer.push(...value);

		while (this.buffer.length > 209) {
			//console.log("decoding... ", this.buffer.length)
			this.decode();	
		}
		this.onDecoded();
	}

	async onPortSelected(port,baud) {
		try {await port.open({ baudRate: baud, bufferSize: 65536 });} //API inconsistency in syntax between linux and windows
		catch {await port.open({ baudrate: baud, bufferSize: 65536 });}
		this.onConnectedCallback();
		this.subscribe(port);
	}

	async subscribe(port){
		while (this.port.readable) {
			const reader = port.readable.getReader();
			try {
				while (true) {
				//console.log("reading...");
				const { value, done } = await reader.read();
				if (done) {
					// Allow the serial port to be closed later.
					reader.releaseLock();
					break;
				}
				if (value) {
					this.onReceive(value);
					//console.log(this.decoder.decode(value));
				}
				}
			} catch (error) {
				console.log(error);// TODO: Handle non-fatal read error.
				break;
			}
		}
	}

	async closePort() {
		await this.port.close();
		this.port = null; 
	}

	async setupSerialAsync(baudrate=921600) { //You can specify baudrate just in case

		const filters = [
			{ usbVendorId: 0x10c4, usbProductId: 0x0043 } //CP2102 filter (e.g. for UART via ESP32)
		];
		
		this.port = await navigator.serial.requestPort();
		navigator.serial.addEventListener("disconnect",(e) => {
			this.closePort();
		})
		this.onPortSelected(this.port,baudrate);
		
	}

		
	//Boyer Moore fast byte search method copied from https://codereview.stackexchange.com/questions/20136/uint8array-indexof-method-that-allows-to-search-for-byte-sequences
	asUint8Array(input) {
		if (input instanceof Uint8Array) {
			return input;
		} else if (typeof(input) === 'string') {
			// This naive transform only supports ASCII patterns. UTF-8 support
			// not necessary for the intended use case here.
			var arr = new Uint8Array(input.length);
			for (var i = 0; i < input.length; i++) {
			var c = input.charCodeAt(i);
			if (c > 127) {
				throw new TypeError("Only ASCII patterns are supported");
			}
			arr[i] = c;
			}
			return arr;
		} else {
			// Assume that it's already something that can be coerced.
			return new Uint8Array(input);
		}
	}

	boyerMoore(patternBuffer) {
		// Implementation of Boyer-Moore substring search ported from page 772 of
		// Algorithms Fourth Edition (Sedgewick, Wayne)
		// http://algs4.cs.princeton.edu/53substring/BoyerMoore.java.html
		/*
		USAGE:
			// needle should be ASCII string, ArrayBuffer, or Uint8Array
			// haystack should be an ArrayBuffer or Uint8Array
			var search = boyerMoore(needle);
			var skip = search.byteLength;
			var indices = [];
			for (var i = search(haystack); i !== -1; i = search(haystack, i + skip)) {
				indices.push(i);
			}
		*/
		var pattern = this.asUint8Array(patternBuffer);
		var M = pattern.length;
		if (M === 0) {
			throw new TypeError("patternBuffer must be at least 1 byte long");
		}
		// radix
		var R = 256;
		var rightmost_positions = new Int32Array(R);
		// position of the rightmost occurrence of the byte c in the pattern
		for (var c = 0; c < R; c++) {
			// -1 for bytes not in pattern
			rightmost_positions[c] = -1;
		}
		for (var j = 0; j < M; j++) {
			// rightmost position for bytes in pattern
			rightmost_positions[pattern[j]] = j;
		}
		var boyerMooreSearch = (txtBuffer, start, end) => {
			// Return offset of first match, -1 if no match.
			var txt = this.asUint8Array(txtBuffer);
			if (start === undefined) start = 0;
			if (end === undefined) end = txt.length;
			var pat = pattern;
			var right = rightmost_positions;
			var lastIndex = end - pat.length;
			var lastPatIndex = pat.length - 1;
			var skip;
			for (var i = start; i <= lastIndex; i += skip) {
				skip = 0;
				for (var j = lastPatIndex; j >= 0; j--) {
				var c = txt[i + j];
				if (pat[j] !== c) {
					skip = Math.max(1, j - right[c]);
					break;
				}
				}
				if (skip === 0) {
				return i;
				}
			}
			return -1;
		};
		boyerMooreSearch.byteLength = pattern.byteLength;
		return boyerMooreSearch;
	}
	//---------------------end copy/pasted solution------------------------

	//EEG Atlas generator
	newCoord(x,y,z,amplitudes=[],means={delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}){
		return {x: x, y:y, z:z, amplitudes:amplitudes, means:means}
	}

	//Input arrays of corresponding tags, xyz coordinates as Array(3) objects, and DFT amplitudes (optional).
	newAtlas(tags=["Fp1","Fp2"], coords = [[-21.5, 70.2,-0.1],[28.4,69.1,-0.4]],amplitudes=undefined,means=null){
		var newLayout = [];
		tags.forEach((tag,i) => {
			if (amplitudes === undefined) {
				newLayout.push({tag: tag, data: this.newCoord(coords[i][0],coords[i][1],coords[i][2],undefined,undefined)});
			}
			else{
				newLayout.push({tag: tag, data: this.newCoord(coords[i][0],coords[i][1],coords[i][2],amplitudes[i],means[i])});
			}
		});
		return newLayout;
	}

	//Returns a 10_20 atlas object with structure { "Fp1": {x,y,z,amplitudes[]}, "Fp2" : {...}, ...}
	makeAtlas10_20(){
		// 19 channel coordinate space. 
		// Based on MNI atlas. 
		return [
			{tag:"Fp1", data: { x: -21.5, y: 70.2, z: -0.1, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},
			{tag:"Fp2", data: { x: 28.4, y: 69.1, z: -0.4, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},
			{tag:"Fz",  data: { x: 0.6, y: 40.9, z: 53.9, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}}, 
			{tag:"F3", data: { x: -35.5, y: 49.4, z: 32.4, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}}, 
			{tag:"F4", data: { x: 40.2, y: 47.6, z: 32.1, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},  
			{tag:"F7", data: { x: -54.8, y: 33.9, z: -3.5, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},
			{tag:"F8", data: { x: 56.6, y: 30.8, z: -4.1, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},  
			{tag:"Cz", data: { x: 0.8, y: -14.7, z: 73.9, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},
			{tag:"C3", data: { x: -52.2, y: -16.4, z: 57.8, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},  
			{tag:"C4", data: { x: 54.1, y: -18.0, z: 57.5, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},  
			{tag:"T3", data: { x: -70.2, y: -21.3, z: -10.7,amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},  
			{tag:"T4", data: { x: 71.9, y: -25.2, z: -8.2, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},  
			{tag:"Pz", data: { x: 0.2, y: -62.1, z: 64.5, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},  
			{tag:"P3", data: { x: -39.5, y: -76.3, z: 47.4, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}}, 
			{tag:"P4", data: { x: 36.8, y: -74.9, z: 49.2, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},  
			{tag:"T5", data: { x: -61.5, y: -65.3, z: 1.1, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},  
			{tag:"T6", data: { x: 59.3, y: -67.6, z: 3.8, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},  
			{tag:"O1", data: { x: -26.8, y: -100.2, z: 12.8, amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}},  
			{tag:"O2", data: { x: 24.1, y: -100.5, z: 14., amplitudes: [], means: {delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0}}}  
		];

	}

}

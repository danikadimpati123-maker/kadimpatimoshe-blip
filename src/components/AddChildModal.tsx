import React, { useState, useEffect } from 'react';
import { 
  X, 
  Smartphone, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Database, 
  Wifi, 
  ShieldCheck,
  ArrowRight,
  Search
} from 'lucide-react';
import { ParentChildDevice } from '../types';
import { searchAndVerifyChildDevice, DeviceVerificationResult } from '../services/firebase';

interface AddChildModalProps {
  onClose: () => void;
  onPair: (code: string, modelName: string) => Promise<ParentChildDevice>;
}

export const AddChildModal: React.FC<AddChildModalProps> = ({ onClose, onPair }) => {
  const [code, setCode] = useState('');
  const [modelName, setModelName] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchResult, setSearchResult] = useState<DeviceVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairedDevice, setPairedDevice] = useState<ParentChildDevice | null>(null);

  // 1. డిబౌన్స్ లాజిక్ & ఎక్జాక్ట్ 6+ క్యారెక్టర్స్ ఉన్నప్పుడే ఫైర్బేస్ కాల్ వెళ్లేలా ఆటో-సెర్చ్
  useEffect(() => {
    const clean = code.trim().toUpperCase();
    
    // కోడ్ కనీసం 6 క్యారెక్టర్లు ఉంటేనే సెర్చ్ ట్రిగ్గర్ అవుతుంది (అనవసరమైన ఫైర్బేస్ కాల్స్ ఆగిపోతాయి)
    if (clean.length >= 6) {
      const timer = setTimeout(() => {
        handleSearch(clean);
      }, 400); // 400ms డిబౌన్స్ టైమర్

      return () => clearTimeout(timer);
    } else {
      setSearchResult(null);
      setError(null);
    }
  }, [code]);

  const handleSearch = async (cleanCode: string) => {
    setIsSearching(true);
    setError(null);
    try {
      const result = await searchAndVerifyChildDevice(cleanCode);
      if (!result || !result.existsInRTDB) {
        // 2. కస్టమ్ ఎర్రర్ హ్యాండ్లింగ్ (డేటా లేకపోతే)
        throw new Error('ఈ బైండింగ్ కోడ్తో ఎలాంటి డివైస్ కనెక్ట్ కాలేదు. దయచేసి చైల్డ్ డివైస్లో కోడ్ సరిచూసుకోండి.');
      }
      setSearchResult(result);
      if (!modelName) {
        setModelName(result.deviceModelName);
      }
    } catch (err: any) {
      // యూజర్ ఫ్రెండ్లీ ఎర్రర్ మెసేజ్ చూపించడం
      setError(err.message || 'ఈ బైండింగ్ కోడ్తో ఎలాంటి డివైస్ కనెక్ట్ కాలేదు. దయచేసి చైల్డ్ డివైస్లో కోడ్ సరిచూసుకోండి.');
      setSearchResult(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode || cleanCode.length < 6) {
      setError('దయచేసి సరైన 6 అక్షరాల బైండింగ్ కోడ్ (ఉదా. FG-XXXXXX) ఎంటర్ చేయండి.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const finalModelName = modelName.trim() || searchResult?.deviceModelName || `Android Device (${cleanCode})`;
      const device = await onPair(cleanCode, finalModelName);
      setPairedDevice(device);
    } catch (err: any) {
      setError(err.message || 'ఫైర్బేస్ RTDB లో డివైస్ను లింక్ చేయడం విఫలమైంది. మళ్లీ ప్రయత్నించండి.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl border border-[#e4e9e5] p-6 max-w-md w-full shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {pairedDevice ? (
          <div className="text-center py-2 space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 mb-2">
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
                స్థితి: ఆన్లైన్ / సింక్ చేయబడింది
              </span>
              <h3 className="text-xl font-extrabold text-neutral-900">
                {pairedDevice.deviceModelName || 'Child Device'}
              </h3>
              <p className="text-xs text-neutral-500 mt-1">
                <code className="text-neutral-700 font-semibold bg-neutral-100 px-1 py-0.5 rounded">/devices/{pairedDevice.pairingCode}</code> ద్వారా వెరిఫై చేయబడి పేరెంట్ కన్సోల్కు లింక్ చేయబడింది.
              </p>
            </div>

            <div className="bg-neutral-50 rounded-xl p-3 border border-neutral-200 text-left text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-neutral-500 font-medium">చైల్డ్ డివైస్ ID:</span>
                <span className="font-mono font-bold text-neutral-800">{pairedDevice.childId}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-500 font-medium">Firebase RTDB నోడ్:</span>
                <span className="font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-bold">
                  /devices/{pairedDevice.pairingCode}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-500 font-medium">లైవ్ ప్రెజెన్స్:</span>
                <span className="font-semibold text-emerald-600 flex items-center gap-1">
                  <Wifi className="w-3 h-3" />
                  లైవ్ సింక్ అయింది
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl font-bold text-xs bg-[#0a9b70] hover:bg-[#087957] text-white transition-colors shadow-xs flex items-center justify-center gap-2"
            >
              పూర్తయింది & కన్సోల్ని తెరవండి
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleLink} className="space-y-4">
            <div className="text-center mb-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-2 border border-emerald-100 shadow-xs">
                <Smartphone className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-extrabold text-[#202b29]">చైల్డ్ డివైస్ని జోడించండి</h3>
              <p className="text-xs text-[#71807b] mt-1">
                మీ పిల్లల డివైస్లో కనిపించే బైండింగ్ కోడ్ (ఉదా. <strong>FG-XXXXXX</strong>) ని ఎంటర్ చేయండి.
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-neutral-700">
                  చైల్డ్ బైండింగ్ కోడ్ (ID)
                </label>
                <span className="text-[11px] text-neutral-400">
                  ఉదాహరణ: FG-ABCDEF
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  {/* 3. ఆటో-క్యాపిటలైజేషన్ (.toUpperCase()) ఇక్కడ వర్తిస్తుంది */}
                  <input
                    type="text"
                    maxLength={12}
                    autoFocus
                    placeholder="FG-ABCDEF"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && code.length >= 6) {
                        e.preventDefault();
                        handleSearch(code.trim().toUpperCase());
                      }
                    }}
                    className="w-full h-12 text-center font-mono font-bold text-xl tracking-[0.1em] bg-neutral-50 border border-[#e4e9e5] rounded-xl focus:border-[#0a9b70] focus:ring-2 focus:ring-emerald-100 outline-none text-neutral-900"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 flex items-center gap-1 text-xs">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => code.length >= 4 && handleSearch(code.trim().toUpperCase())}
                  disabled={isSearching || code.length < 4}
                  className="h-12 px-4 rounded-xl border border-neutral-300 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-40 shrink-0"
                  title="Search Firebase RTDB /devices/{pairingCode}"
                >
                  <Search className="w-3.5 h-3.5 text-neutral-500" />
                  సెర్చ్ RTDB
                </button>
              </div>
            </div>

            {/* Active RTDB Search Result Card */}
            {searchResult && (
              <div className="p-3.5 bg-emerald-50/90 rounded-xl border border-emerald-200 text-xs space-y-2 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-emerald-700 shrink-0" />
                    వెరిఫై అయింది: {searchResult.rtdbPath}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-200 text-emerald-900 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                    సింక్ చేయడానికి సిద్ధంగా ఉంది
                  </span>
                </div>
                <div className="text-neutral-700 space-y-1 pt-1 border-t border-emerald-200/60 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-neutral-500">డివైస్ మోడల్:</span>
                    <span className="font-bold text-neutral-900">{searchResult.deviceModelName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">ఫైర్బేస్ నోడ్:</span>
                    <span className="font-mono text-emerald-800 font-semibold">{searchResult.rtdbPath}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">పేరింగ్ స్థితి:</span>
                    <span className="capitalize font-semibold text-emerald-700">ఆన్లైన్ & లింక్ చేయడానికి సిద్ధం</span>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                కస్టమ్ చైల్డ్ లేబుల్ (ఐచ్ఛికం)
              </label>
              <input
                type="text"
                placeholder={searchResult?.deviceModelName || "ఉదా. Liam's Phone"}
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                className="w-full h-10 px-3 text-xs bg-neutral-50 border border-[#e4e9e5] rounded-xl focus:border-[#0a9b70] focus:ring-2 focus:ring-emerald-100 outline-none text-neutral-900"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting || !code || code.length < 4}
                className="w-full h-11 rounded-xl text-xs font-bold bg-[#0a9b70] hover:bg-[#087957] text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-xs"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    కన్సోల్కు లింక్ అవుతోంది...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    వెరిఫై చేసి లింక్ చేయండి {code ? `(${code})` : ''}
                  </>
                )}
              </button>
            </div>

            <div className="pt-2 border-t border-neutral-100 text-[11px] text-neutral-400 text-center leading-normal">
              Firebase RTDB <code className="text-neutral-600 bg-neutral-100 px-1 rounded">/devices/{code || 'FG-XXXXXX'}</code> ను క్వెరీ చేసి, చైల్డ్ ప్రెజెన్స్ను వెరిఫై చేసి ఆన్లైన్కి అప్డేట్ చేస్తుంది.
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

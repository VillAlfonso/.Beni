import anchors


def test_resolve_ref_uses_passed_library():
    name, ref = anchors.resolve_ref("teasing", {"teasing": {"audio": "x/teasing.wav"}})
    assert name == "teasing"
    assert ref["audio"] == "x/teasing.wav"


def test_resolve_ref_falls_back_inside_passed_library():
    lib = {"lecturing": {"audio": "x/lecturing.wav"}, "neutral": {"audio": "x/n.wav"}}
    name, ref = anchors.resolve_ref("belittling", lib)
    assert name == "lecturing"
    assert ref["audio"] == "x/lecturing.wav"


def test_resolve_ref_defaults_to_full_library():
    _, ref = anchors.resolve_ref("neutral")
    assert ref and "audio" in ref


def test_load_gsv_refs_lists_existing_wavs(tmp_path, monkeypatch):
    refs = tmp_path / "gsv-refs"
    refs.mkdir()
    (refs / "neutral.wav").write_bytes(b"RIFF")
    (refs / "teasing.wav").write_bytes(b"RIFF")
    monkeypatch.setattr(anchors, "GSV_REFS", refs)
    lib = anchors.load_gsv_refs()
    assert set(lib) == {"neutral", "teasing"}
    assert lib["neutral"]["audio"].endswith("gsv-refs/neutral.wav")

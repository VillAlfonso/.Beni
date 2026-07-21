import server


def test_single_reply_keeps_one_pair_per_sentence():
    pairs = server.segment_reply('"Get out. Now."')
    assert [sentence for sentence, _ in pairs] == ["Get out.", "Now."]
    assert all(isinstance(mood, str) and mood for _, mood in pairs)


def test_forced_mood_overrides_every_sentence():
    pairs = server.segment_reply('"Hello there. How nice."', forced_mood="angry")
    assert pairs and all(mood == "angry" for _, mood in pairs)


def test_local_direction_selects_a_different_later_mood():
    raw = '*She snaps, furious.* "Get away from me." *Then, quietly, she looks away.* "...just go."'
    pairs = server.segment_reply(raw)
    moods = [mood for _, mood in pairs]
    assert moods[0] == "angry"
    assert moods[-1] in ("sad", "neutral", "touched")
    assert moods[0] != moods[-1]


def test_stage_direction_only_has_no_speech():
    assert server.segment_reply("*shrugs*") == []


def test_distinct_registers_are_selected_from_local_direction():
    assert server.segment_reply('*She answers firmly.* "Enough."')[0][1] == "assertive"
    assert server.segment_reply('*She grows flustered.* "Stop looking at me."')[0][1] == "flustered"


def test_long_reply_is_not_silently_truncated():
    raw = '"' + "A complete sentence. " * 120 + '"'
    assert len(server.segment_reply(raw)) == 120
